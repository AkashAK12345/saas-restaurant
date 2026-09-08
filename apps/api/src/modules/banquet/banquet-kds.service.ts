import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditEventType,
  BanquetBookingStatus,
  BanquetKdsStatus,
  Prisma,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import {
  EVENT_BROKER,
  type EventBroker,
  type RealtimeScope,
} from '../../common/realtime/event-broker.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import { branchLocalDate, toBranchLocal } from '../../common/scheduler/branch-time.js';
import type { BanquetActorContext } from './banquet-context.js';
import {
  InvalidKdsTransitionError,
  assertKdsTransition,
} from './banquet-state-machine.js';
import {
  BANQUET_EVENT_TYPES,
  BOOKING_INCLUDE,
  BanquetBookingsService,
  type BookingRecord,
} from './banquet-bookings.service.js';
import type {
  BanquetBookingItemView,
  ChefBoardView,
  StaffKdsBoardView,
} from './banquet-views.js';

const AUDIT_ITEM = 'BANQUET_BOOKING_ITEM';

/** One branch-day of events is far below this; the cap just bounds the query. */
const BOARD_MAX_BOOKINGS = 200;

/**
 * The kitchen board and the item lifecycle behind it.
 *
 * WHAT THE KITCHEN SEES: only bookings that are CONFIRMED or COMPLETED — a
 * draft enquiry is not something to cook — for one branch-local day. The day
 * is computed with the branch's own timezone (T0-C helpers), never the
 * server's, so a kitchen in Mumbai sees the Mumbai day.
 *
 * WHO MAY WRITE: staff only. A display device can read its branch's board and
 * receive events; it can never advance an item. That is enforced by the guards
 * on the controllers — the device routes have no mutation at all.
 */
@Injectable()
export class BanquetKdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly bookings: BanquetBookingsService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
  ) {}

  /** Staff board: the chef projection plus who each event is for. */
  async staffBoard(branchId: string, serviceDate?: string): Promise<StaffKdsBoardView> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    return {
      branch_id: branchId,
      service_date: date,
      bookings: rows.map((b) => ({
        ...this.bookings.toChefView(b),
        customer_name: b.customer?.name ?? null,
      })),
      counts: this.countItems(rows),
    };
  }

  /** Device board: no customer identity, no money. Safe for a kitchen wall. */
  async chefBoard(branchId: string, serviceDate?: string): Promise<ChefBoardView> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    return {
      branch_id: branchId,
      service_date: date,
      bookings: rows.map((b) => this.bookings.toChefView(b)),
      counts: this.countItems(rows),
    };
  }

  /** PENDING ─▶ IN_PROGRESS */
  async startItem(ctx: BanquetActorContext, itemId: string): Promise<BanquetBookingItemView> {
    return this.advance(ctx, itemId, BanquetKdsStatus.IN_PROGRESS, 'start_item');
  }

  /** PENDING|IN_PROGRESS ─▶ READY */
  async readyItem(ctx: BanquetActorContext, itemId: string): Promise<BanquetBookingItemView> {
    return this.advance(ctx, itemId, BanquetKdsStatus.READY, 'ready_item');
  }

  private async advance(
    ctx: BanquetActorContext,
    itemId: string,
    to: BanquetKdsStatus,
    action: string,
  ): Promise<BanquetBookingItemView> {
    let booking: BookingRecord;
    let item: { id: string; name: string; position: number; kds_status: BanquetKdsStatus; started_at: Date | null; ready_at: Date | null };

    try {
      ({ booking, item } = await this.prisma.$transaction(async (tx) => {
        // Scoped through the parent booking in ONE query — an item belonging
        // to another branch or company is simply not found.
        const current = await tx.banquetBookingItem.findFirst({
          where: {
            id: itemId,
            booking: { branch_id: ctx.branchId, company_id: ctx.companyId },
          },
          include: { booking: { select: { id: true, status: true } } },
        });
        if (!current) throw new NotFoundException();
        if (
          current.booking.status !== BanquetBookingStatus.CONFIRMED &&
          current.booking.status !== BanquetBookingStatus.COMPLETED
        ) {
          throw new ConflictException(
            'Only a confirmed event has kitchen items to prepare',
          );
        }

        assertKdsTransition(current.kds_status, to);

        const stamps: Prisma.BanquetBookingItemUncheckedUpdateInput =
          to === BanquetKdsStatus.IN_PROGRESS
            ? { started_at: new Date() }
            : { ready_at: new Date() };

        // Conditional on the status we validated — two chefs tapping at once
        // produce one success and one controlled conflict.
        const { count } = await tx.banquetBookingItem.updateMany({
          where: { id: current.id, kds_status: current.kds_status },
          data: { ...stamps, kds_status: to },
        });
        if (count !== 1) throw new ConflictException('Item was modified concurrently');

        await this.auditLogService.create(
          {
            actorUserId: ctx.actorUserId,
            companyId: ctx.companyId,
            branchId: ctx.branchId,
            eventType: AuditEventType.UPDATE,
            entityType: AUDIT_ITEM,
            entityId: current.id,
            payload: {
              action,
              booking_id: current.booking.id,
              previous_status: current.kds_status,
              new_status: to,
            },
          },
          tx,
        );

        const updated = await tx.banquetBookingItem.findUniqueOrThrow({ where: { id: current.id } });
        const parent = await tx.banquetBooking.findUniqueOrThrow({
          where: { id: current.booking.id },
          include: BOOKING_INCLUDE,
        });
        return { booking: parent, item: updated };
      }));
    } catch (e) {
      if (e instanceof InvalidKdsTransitionError) throw new ConflictException(e.message);
      throw e;
    }

    // After commit only.
    const scope: RealtimeScope = {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      channel: RealtimeChannel.BANQUET_KDS,
    };
    this.broker.publish(scope, BANQUET_EVENT_TYPES.ITEM_UPDATED, this.bookings.toChefView(booking));

    return {
      id: item.id,
      name: item.name,
      position: item.position,
      kds_status: item.kds_status,
      started_at: item.started_at,
      ready_at: item.ready_at,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Bookings whose event STARTS on the given branch-local day. Matching is
   * done on absolute instants: the branch-local day is converted to the UTC
   * window it actually spans, so DST transitions shift the window correctly
   * rather than being ignored.
   */
  private async boardRows(
    branchId: string,
    serviceDate?: string,
  ): Promise<{ date: string; rows: BookingRecord[] }> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();

    const date = serviceDate ?? branchLocalDate(new Date(), branch.timezone);
    const { start, end } = this.branchDayWindow(date, branch.timezone);

    const rows = await this.prisma.banquetBooking.findMany({
      where: {
        branch_id: branchId,
        status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
        starts_at: { gte: start, lt: end },
      },
      include: BOOKING_INCLUDE,
      orderBy: { starts_at: 'asc' },
      take: BOARD_MAX_BOOKINGS,
    });
    return { date, rows };
  }

  /**
   * The UTC instants bounding a branch-local calendar day.
   *
   * Derived by probing the zone rather than assuming a fixed offset, so a day
   * that is 23 or 25 hours long because of a DST change still maps to exactly
   * that day. `toBranchLocal` is the T0-C helper; nothing here does wall-clock
   * arithmetic of its own.
   */
  private branchDayWindow(date: string, timezone: string): { start: Date; end: Date } {
    const midnightUtc = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(midnightUtc.getTime())) {
      throw new ConflictException('service_date must be a valid calendar date');
    }
    const offsetAt = (instant: Date): number => {
      const local = toBranchLocal(instant, timezone);
      const asUtc = Date.parse(`${local.date}T${local.time}:${String(local.second).padStart(2, '0')}Z`);
      return asUtc - instant.getTime();
    };
    // First approximation, then correct with the offset actually in force at
    // that moment (handles a day whose offset differs from UTC midnight's).
    const roughStart = new Date(midnightUtc.getTime() - offsetAt(midnightUtc));
    const start = new Date(midnightUtc.getTime() - offsetAt(roughStart));

    const nextMidnightUtc = new Date(midnightUtc.getTime() + 24 * 60 * 60 * 1000);
    const roughEnd = new Date(nextMidnightUtc.getTime() - offsetAt(nextMidnightUtc));
    const end = new Date(nextMidnightUtc.getTime() - offsetAt(roughEnd));

    return { start, end };
  }

  private countItems(rows: BookingRecord[]): ChefBoardView['counts'] {
    const counts = { events: rows.length, pending: 0, in_progress: 0, ready: 0 };
    for (const b of rows) {
      for (const i of b.items) {
        if (i.kds_status === BanquetKdsStatus.PENDING) counts.pending++;
        else if (i.kds_status === BanquetKdsStatus.IN_PROGRESS) counts.in_progress++;
        else counts.ready++;
      }
    }
    return counts;
  }
}

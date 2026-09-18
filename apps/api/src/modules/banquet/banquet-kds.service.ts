import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import {
  branchLocalDate,
  branchLocalToInstant,
  toBranchLocal,
} from '../../common/scheduler/branch-time.js';
import { addDays, isCalendarDate } from './banquet-catalog.service.js';
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
  ChefCalendarBookingView,
  ChefCalendarView,
  StaffKdsBoardView,
} from './banquet-views.js';

const AUDIT_ITEM = 'BANQUET_BOOKING_ITEM';

/** One branch-day of events is far below this; the cap just bounds the query. */
const BOARD_MAX_BOOKINGS = 200;

/** A month view spans at most six weeks. */
export const CALENDAR_MAX_DAYS = 42;
const CALENDAR_MAX_BOOKINGS = 1000;

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

  /**
   * Staff board: the chef projection plus who each event is for. The name is
   * customer data, so it is only filled when the caller also holds
   * banquet.view — the controller decides; a kitchen role with
   * banquet.kds.view alone sees what the wall screen sees.
   */
  async staffBoard(
    branchId: string,
    serviceDate?: string,
    includeCustomer = false,
  ): Promise<StaffKdsBoardView> {
    const { date, rows } = await this.boardRows(branchId, serviceDate);
    return {
      branch_id: branchId,
      service_date: date,
      bookings: rows.map((b) => ({
        ...this.bookings.toChefView(b),
        customer_name: includeCustomer ? (b.customer?.name ?? null) : null,
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

  /**
   * The chef calendar: every confirmed or completed event starting within a
   * branch-local date range (a week or a month), with its menu. Drafts stay
   * invisible to the kitchen, as on the board. Each event is matched to the
   * hall slot it sits in (Lunch, Dinner…) by its branch-local start time.
   */
  async chefCalendar(
    branchId: string,
    from: string,
    to: string,
    includeCustomer = false,
  ): Promise<ChefCalendarView> {
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      throw new BadRequestException('from and to must be real calendar dates');
    }
    if (to < from) throw new BadRequestException('to must not be before from');
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > CALENDAR_MAX_DAYS) {
      throw new BadRequestException(`Ask for at most ${CALENDAR_MAX_DAYS} days at a time`);
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();
    const tz = branch.timezone;

    const rows = await this.prisma.banquetBooking.findMany({
      where: {
        branch_id: branchId,
        status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
        starts_at: {
          gte: branchLocalToInstant(from, '00:00', tz),
          lt: branchLocalToInstant(addDays(to, 1), '00:00', tz),
        },
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ starts_at: 'asc' }, { id: 'asc' }],
      take: CALENDAR_MAX_BOOKINGS,
    });

    return {
      branch_id: branchId,
      from,
      to,
      timezone: tz,
      bookings: await this.toCalendarViews(rows, tz, includeCustomer),
    };
  }

  /**
   * One event as the chef calendar shows it, for its full-screen details.
   * Same visibility as the calendar: only a confirmed or completed booking of
   * this branch; anything else is a 404, never a hint that it exists.
   */
  async chefEvent(
    branchId: string,
    bookingId: string,
    includeCustomer = false,
  ): Promise<ChefCalendarBookingView> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();
    const booking = await this.prisma.banquetBooking.findFirst({
      where: {
        id: bookingId,
        branch_id: branchId,
        status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
      },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException();
    const [view] = await this.toCalendarViews([booking], branch.timezone, includeCustomer);
    return view;
  }

  /** Chef projections plus day, slot and menu name; the customer only when allowed. */
  private async toCalendarViews(
    rows: BookingRecord[],
    tz: string,
    includeCustomer: boolean,
  ): Promise<ChefCalendarBookingView[]> {
    const slots = rows.length
      ? await this.prisma.banquetHallSlot.findMany({
          where: { hall_id: { in: [...new Set(rows.map((b) => b.hall_id))] } },
          select: { hall_id: true, name: true, start_time: true, end_time: true },
          orderBy: [{ position: 'asc' }, { start_time: 'asc' }],
        })
      : [];

    const slotFor = (hallId: string, localStart: string): string | null => {
      const own = slots.filter((s) => s.hall_id === hallId);
      const exact = own.find((s) => s.start_time === localStart);
      if (exact) return exact.name;
      // Otherwise the slot the start falls inside (overnight slots wrap past midnight).
      const inside = own.find((s) =>
        s.end_time > s.start_time
          ? localStart >= s.start_time && localStart < s.end_time
          : localStart >= s.start_time || localStart < s.end_time,
      );
      return inside?.name ?? null;
    };

    return rows.map((b) => {
      const local = toBranchLocal(b.starts_at, tz);
      return {
        ...this.bookings.toChefView(b),
        date: local.date,
        customer_name: includeCustomer ? (b.customer?.name ?? null) : null,
        slot_name: slotFor(b.hall_id, local.time),
        package_name: b.package_name,
        setup_notes: b.event_plan?.setup_notes ?? null,
      };
    });
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
      orderBy: [{ starts_at: 'asc' }, { id: 'asc' }],
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

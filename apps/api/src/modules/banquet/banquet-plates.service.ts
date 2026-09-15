import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditEventType, BanquetBookingStatus, Prisma } from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { EVENT_BROKER, type EventBroker } from '../../common/realtime/event-broker.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import { branchLocalDate, branchLocalToInstant } from '../../common/scheduler/branch-time.js';
import { isCalendarDate } from '../reports/report-range.js';
import type { BanquetActorContext } from './banquet-context.js';
import { BANQUET_EVENT_TYPES } from './banquet-bookings.service.js';
import {
  InvalidPlateTransitionError,
  assertPlateTransition,
  type PlateRequestStatus,
} from './banquet-state-machine.js';
import type { CreatePlateRequestDto } from './banquet.dto.js';

const AUDIT_PLATE = 'BANQUET_PLATE_REQUEST';

/** A day of one branch's events never comes near this; it only bounds the query. */
const LIST_MAX = 500;

const PERSON = { select: { id: true, first_name: true, last_name: true, email: true } } as const;

const PLATE_INCLUDE = {
  item: { select: { id: true, name: true } },
  booking: { select: { id: true, hall_name: true, starts_at: true } },
  requested_by: PERSON,
  decided_by: PERSON,
  dispatched_by: PERSON,
} satisfies Prisma.BanquetPlateRequestInclude;

type PlateRecord = Prisma.BanquetPlateRequestGetPayload<{ include: typeof PLATE_INCLUDE }>;

interface StaffRef {
  id: string;
  name: string;
}

/**
 * What a plate request looks like to staff. Kitchen-safe: the hall and the dish,
 * never the customer or any money.
 */
export interface BanquetPlateRequestView {
  id: string;
  booking_id: string;
  hall_name: string | null;
  event_starts_at: Date;
  item: { id: string; name: string };
  plates: number;
  note: string | null;
  status: PlateRequestStatus;
  requested_at: Date;
  requested_by: StaffRef;
  decided_at: Date | null;
  decided_by: StaffRef | null;
  rejection_reason: string | null;
  dispatched_at: Date | null;
  dispatched_by: StaffRef | null;
}

function staff(u: { id: string; first_name: string | null; last_name: string | null; email: string } | null): StaffRef | null {
  if (!u) return null;
  return { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Plate approval (SRS §5.3.5).
 *
 * Every write runs in one transaction with its audit entry, and every status
 * move is a CONDITIONAL update on the status that was validated — two cooks
 * tapping Approve at once produce one success and one controlled 409. The
 * separation of duties (nobody decides their own request) is checked here and
 * enforced again by a database CHECK. Realtime is published after commit only,
 * on the branch's banquet-kds channel, carrying ids and a status — no customer.
 */
@Injectable()
export class BanquetPlatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
  ) {}

  /** One booking's requests, newest first. 404 for a booking outside the branch. */
  async listForBooking(branchId: string, bookingId: string): Promise<BanquetPlateRequestView[]> {
    const booking = await this.prisma.banquetBooking.findFirst({
      where: { id: bookingId, branch_id: branchId },
      select: { id: true },
    });
    if (!booking) throw new NotFoundException();
    const rows = await this.prisma.banquetPlateRequest.findMany({
      where: { booking_id: booking.id, branch_id: branchId },
      include: PLATE_INCLUDE,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: LIST_MAX,
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * The kitchen's list: requests for events that START on one branch-local
   * day (default today at the branch), oldest first so the queue reads in order.
   */
  async listForDay(branchId: string, serviceDate?: string): Promise<{ service_date: string; requests: BanquetPlateRequestView[] }> {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
    if (!branch) throw new NotFoundException();
    const date = serviceDate ?? branchLocalDate(new Date(), branch.timezone);
    if (!isCalendarDate(date)) throw new BadRequestException('service_date must be a valid calendar date');

    const rows = await this.prisma.banquetPlateRequest.findMany({
      where: {
        branch_id: branchId,
        booking: {
          status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
          starts_at: {
            gte: branchLocalToInstant(date, '00:00', branch.timezone),
            lt: branchLocalToInstant(addDays(date, 1), '00:00', branch.timezone),
          },
        },
      },
      include: PLATE_INCLUDE,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: LIST_MAX,
    });
    return { service_date: date, requests: rows.map((r) => this.toView(r)) };
  }

  async request(ctx: BanquetActorContext, bookingId: string, dto: CreatePlateRequestDto): Promise<BanquetPlateRequestView> {
    const record = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.banquetBooking.findFirst({
        where: { id: bookingId, branch_id: ctx.branchId, company_id: ctx.companyId },
        select: { id: true, status: true },
      });
      if (!booking) throw new NotFoundException();
      if (booking.status !== BanquetBookingStatus.CONFIRMED) {
        throw new ConflictException('Plates can be requested only for a confirmed event');
      }
      const item = await tx.banquetBookingItem.findFirst({
        where: { id: dto.item_id, booking_id: booking.id },
        select: { id: true, name: true },
      });
      if (!item) throw new UnprocessableEntityException('That dish is not on this booking');

      const created = await tx.banquetPlateRequest.create({
        data: {
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          booking_id: booking.id,
          item_id: item.id,
          plates: dto.plates,
          note: dto.note ? dto.note : null,
          requested_by_user_id: ctx.actorUserId,
        },
        include: PLATE_INCLUDE,
      });

      await this.auditLogService.create(
        {
          actorUserId: ctx.actorUserId,
          companyId: ctx.companyId,
          branchId: ctx.branchId,
          eventType: AuditEventType.CREATE,
          entityType: AUDIT_PLATE,
          entityId: created.id,
          payload: {
            action: 'request_plates',
            booking_id: booking.id,
            item_name: item.name,
            plates: dto.plates,
            has_note: !!dto.note,
          },
        },
        tx,
      );
      return created;
    });

    this.publish(ctx, record);
    return this.toView(record);
  }

  approve(ctx: BanquetActorContext, id: string): Promise<BanquetPlateRequestView> {
    return this.move(ctx, id, 'APPROVED', 'approve_plates');
  }

  reject(ctx: BanquetActorContext, id: string, reason: string): Promise<BanquetPlateRequestView> {
    return this.move(ctx, id, 'REJECTED', 'reject_plates', reason);
  }

  dispatch(ctx: BanquetActorContext, id: string): Promise<BanquetPlateRequestView> {
    return this.move(ctx, id, 'DISPATCHED', 'dispatch_plates');
  }

  private async move(
    ctx: BanquetActorContext,
    id: string,
    to: PlateRequestStatus,
    action: string,
    reason?: string,
  ): Promise<BanquetPlateRequestView> {
    let record: PlateRecord;
    try {
      record = await this.prisma.$transaction(async (tx) => {
        const current = await tx.banquetPlateRequest.findFirst({
          where: { id, branch_id: ctx.branchId, company_id: ctx.companyId },
          select: { id: true, status: true, booking_id: true, plates: true, requested_by_user_id: true },
        });
        if (!current) throw new NotFoundException();

        const deciding = to === 'APPROVED' || to === 'REJECTED';
        if (deciding && current.requested_by_user_id === ctx.actorUserId) {
          throw new ForbiddenException('A plate request is decided by someone other than the person who asked for it');
        }
        assertPlateTransition(current.status, to);

        const now = new Date();
        const data: Prisma.BanquetPlateRequestUncheckedUpdateManyInput = deciding
          ? {
              status: to,
              decided_by_user_id: ctx.actorUserId,
              decided_at: now,
              rejection_reason: to === 'REJECTED' ? (reason ?? null) : null,
            }
          : { status: to, dispatched_by_user_id: ctx.actorUserId, dispatched_at: now };

        // Conditional on the status just validated: a concurrent decision
        // leaves nothing to update and becomes a controlled conflict.
        const { count } = await tx.banquetPlateRequest.updateMany({
          where: { id: current.id, status: current.status },
          data,
        });
        if (count !== 1) throw new ConflictException('The plate request was changed by someone else');

        await this.auditLogService.create(
          {
            actorUserId: ctx.actorUserId,
            companyId: ctx.companyId,
            branchId: ctx.branchId,
            eventType: AuditEventType.UPDATE,
            entityType: AUDIT_PLATE,
            entityId: current.id,
            payload: {
              action,
              booking_id: current.booking_id,
              plates: current.plates,
              previous_status: current.status,
              new_status: to,
              ...(to === 'REJECTED' ? { has_reason: true } : {}),
            },
          },
          tx,
        );

        return tx.banquetPlateRequest.findUniqueOrThrow({ where: { id: current.id }, include: PLATE_INCLUDE });
      });
    } catch (e) {
      if (e instanceof InvalidPlateTransitionError) throw new ConflictException(e.message);
      throw e;
    }

    this.publish(ctx, record);
    return this.toView(record);
  }

  private publish(ctx: BanquetActorContext, record: PlateRecord): void {
    this.broker.publish(
      { companyId: ctx.companyId, branchId: ctx.branchId, channel: RealtimeChannel.BANQUET_KDS },
      BANQUET_EVENT_TYPES.PLATE_REQUEST_UPDATED,
      { id: record.id, booking_id: record.booking_id, status: record.status },
    );
  }

  private toView(r: PlateRecord): BanquetPlateRequestView {
    return {
      id: r.id,
      booking_id: r.booking_id,
      hall_name: r.booking.hall_name,
      event_starts_at: r.booking.starts_at,
      item: r.item,
      plates: r.plates,
      note: r.note,
      status: r.status,
      requested_at: r.created_at,
      requested_by: staff(r.requested_by)!,
      decided_at: r.decided_at,
      decided_by: staff(r.decided_by),
      rejection_reason: r.rejection_reason,
      dispatched_at: r.dispatched_at,
      dispatched_by: staff(r.dispatched_by),
    };
  }
}

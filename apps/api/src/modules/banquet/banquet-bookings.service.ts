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
  BanquetHallStatus,
  BanquetPackageStatus,
  CustomerStatus,
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
import type { Paginated } from '../../common/pagination.dto.js';
import type { BanquetActorContext } from './banquet-context.js';
import {
  INITIAL_BOOKING_STATUS,
  InvalidBookingTransitionError,
  assertBookingTransition,
  isEditable,
} from './banquet-state-machine.js';
import {
  assertCurrencyCode,
  balanceMinor,
  computeTotalMinor,
  sumPaidMinor,
} from './banquet-money.js';
import type {
  BanquetBalanceView,
  BanquetBookingDetailView,
  BanquetBookingItemView,
  BanquetBookingView,
  BanquetEventPlanView,
  BanquetPaymentView,
  ChefBookingView,
} from './banquet-views.js';
import type {
  CreateBookingDto,
  CreatePaymentDto,
  ListBookingsQueryDto,
  UpdateBookingDto,
  UpsertEventPlanDto,
} from './banquet.dto.js';

/**
 * Realtime event types published on the `banquet-kds` channel. Every payload
 * is a ChefBookingView — safe for a kitchen screen (see banquet-views.ts).
 */
export const BANQUET_EVENT_TYPES = {
  BOOKING_CONFIRMED: 'banquet.booking.confirmed',
  BOOKING_CANCELLED: 'banquet.booking.cancelled',
  BOOKING_COMPLETED: 'banquet.booking.completed',
  EVENT_PLAN_UPDATED: 'banquet.event_plan.updated',
  ITEM_UPDATED: 'banquet.item.updated',
} as const;

const AUDIT_BOOKING = 'BANQUET_BOOKING';
const AUDIT_PAYMENT = 'BANQUET_PAYMENT';
const AUDIT_EVENT_PLAN = 'BANQUET_EVENT_PLAN';

export const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true } },
  hall: { select: { id: true, name: true, capacity: true } },
  items: { orderBy: { position: 'asc' } },
  payments: { orderBy: { paid_at: 'asc' } },
  event_plan: true,
} satisfies Prisma.BanquetBookingInclude;

export type BookingRecord = Prisma.BanquetBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

@Injectable()
export class BanquetBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    branchId: string,
    query: ListBookingsQueryDto,
  ): Promise<Paginated<BanquetBookingView>> {
    const where: Prisma.BanquetBookingWhereInput = { branch_id: branchId };
    if (query.status) where.status = query.status;
    if (query.hall_id) where.hall_id = query.hall_id;
    if (query.from || query.to) {
      where.starts_at = {
        ...(query.from ? { gte: this.parseInstant(query.from, 'from') } : {}),
        ...(query.to ? { lte: this.parseInstant(query.to, 'to') } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.banquetBooking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { starts_at: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.banquetBooking.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toBookingView(r)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /** Scoped by id AND branch in one query; 404 for anything out of scope. */
  async get(branchId: string, bookingId: string): Promise<BanquetBookingDetailView> {
    const booking = await this.prisma.banquetBooking.findFirst({
      where: { id: bookingId, branch_id: branchId },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException();
    return this.toDetailView(booking);
  }

  async listPayments(branchId: string, bookingId: string): Promise<BanquetPaymentView[]> {
    const booking = await this.get(branchId, bookingId);
    return booking.payments;
  }

  async getEventPlan(branchId: string, bookingId: string): Promise<BanquetEventPlanView | null> {
    const booking = await this.get(branchId, bookingId);
    return booking.event_plan;
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  /**
   * A booking starts as a DRAFT and holds no hall — see the state machine.
   * The package's commercial terms and component list are SNAPSHOTTED here, so
   * editing the package afterwards can never change what this event meant.
   */
  async create(ctx: BanquetActorContext, dto: CreateBookingDto): Promise<BanquetBookingDetailView> {
    const { startsAt, endsAt } = this.parseWindow(dto.starts_at, dto.ends_at);

    const booking = await this.mutate(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customer_id, company_id: ctx.companyId },
        select: { id: true, status: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.status !== CustomerStatus.ACTIVE) {
        throw new ConflictException('Customer is inactive');
      }

      const hall = await this.resolveHall(tx, ctx.branchId, dto.hall_id, dto.guest_count);

      const pkg = await tx.banquetPackage.findFirst({
        where: { id: dto.package_id, company_id: ctx.companyId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      if (pkg.status !== BanquetPackageStatus.ACTIVE) {
        throw new ConflictException('Package is inactive');
      }

      const currency = assertCurrencyCode(pkg.currency);
      const total = computeTotalMinor(pkg.price_per_guest_minor, dto.guest_count);

      const created = await tx.banquetBooking.create({
        data: {
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          customer_id: customer.id,
          hall_id: hall.id,
          package_id: pkg.id,
          starts_at: startsAt,
          ends_at: endsAt,
          guest_count: dto.guest_count,
          status: INITIAL_BOOKING_STATUS,
          // Commercial snapshot — fixed for the life of the booking.
          package_name: pkg.name,
          price_per_guest_minor: pkg.price_per_guest_minor,
          currency,
          total_amount_minor: total,
          notes: dto.notes ?? null,
          items: {
            create: pkg.items.map((item) => ({ name: item.name, position: item.position })),
          },
        },
        include: BOOKING_INCLUDE,
      });

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_BOOKING, created.id, {
        action: 'create_booking',
        hall_id: hall.id,
        package_id: pkg.id,
        guest_count: dto.guest_count,
        total_amount_minor: total,
        currency,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      return created;
    });

    // A draft is invisible to the kitchen, so nothing is published yet.
    return this.toDetailView(booking);
  }

  /** Draft-only edits. Changing the guest count re-prices from the snapshot. */
  async update(
    ctx: BanquetActorContext,
    bookingId: string,
    dto: UpdateBookingDto,
  ): Promise<BanquetBookingDetailView> {
    const booking = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, bookingId);
      if (!isEditable(current.status)) {
        throw new ConflictException(
          `A ${current.status.toLowerCase()} booking can no longer be edited`,
        );
      }

      const startsAt = dto.starts_at ? this.parseInstant(dto.starts_at, 'starts_at') : current.starts_at;
      const endsAt = dto.ends_at ? this.parseInstant(dto.ends_at, 'ends_at') : current.ends_at;
      if (endsAt <= startsAt) {
        throw new BadRequestException('ends_at must be after starts_at');
      }

      const guestCount = dto.guest_count ?? current.guest_count;
      const hallId = dto.hall_id ?? current.hall_id;
      if (dto.hall_id !== undefined || dto.guest_count !== undefined) {
        await this.resolveHall(tx, ctx.branchId, hallId, guestCount);
      }

      const data: Prisma.BanquetBookingUncheckedUpdateInput = {
        starts_at: startsAt,
        ends_at: endsAt,
        guest_count: guestCount,
        hall_id: hallId,
        // Re-priced from the SNAPSHOT, never from the live package.
        total_amount_minor: computeTotalMinor(current.price_per_guest_minor, guestCount),
      };
      if (dto.notes !== undefined) data.notes = dto.notes;

      const { count } = await tx.banquetBooking.updateMany({
        where: { id: current.id, status: BanquetBookingStatus.DRAFT },
        data,
      });
      if (count !== 1) throw new ConflictException('Booking was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, current.id, {
        action: 'update_booking',
        changed_fields: Object.keys(dto),
        guest_count: guestCount,
        total_amount_minor: data.total_amount_minor as number,
      });
      return this.reload(tx, current.id);
    });
    return this.toDetailView(booking);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * DRAFT ─▶ CONFIRMED. This is what CLAIMS the hall: the database exclusion
   * constraint refuses a second confirmed booking overlapping the same hall,
   * so two operators confirming competing drafts at the same instant cannot
   * both succeed however the timing falls.
   */
  async confirm(ctx: BanquetActorContext, bookingId: string): Promise<BanquetBookingDetailView> {
    const booking = await this.transition(
      ctx,
      bookingId,
      BanquetBookingStatus.CONFIRMED,
      { confirmed_at: new Date() },
      'confirm',
    );
    return this.emitAndDetail(ctx, BANQUET_EVENT_TYPES.BOOKING_CONFIRMED, booking);
  }

  /** CONFIRMED ─▶ COMPLETED. The slot stays claimed so history stays truthful. */
  async complete(ctx: BanquetActorContext, bookingId: string): Promise<BanquetBookingDetailView> {
    const booking = await this.transition(
      ctx,
      bookingId,
      BanquetBookingStatus.COMPLETED,
      { completed_at: new Date() },
      'complete',
    );
    return this.emitAndDetail(ctx, BANQUET_EVENT_TYPES.BOOKING_COMPLETED, booking);
  }

  /** DRAFT|CONFIRMED ─▶ CANCELLED, releasing the hall immediately. */
  async cancel(ctx: BanquetActorContext, bookingId: string): Promise<BanquetBookingDetailView> {
    const booking = await this.transition(
      ctx,
      bookingId,
      BanquetBookingStatus.CANCELLED,
      { cancelled_at: new Date() },
      'cancel',
    );
    return this.emitAndDetail(ctx, BANQUET_EVENT_TYPES.BOOKING_CANCELLED, booking);
  }

  private async transition(
    ctx: BanquetActorContext,
    bookingId: string,
    to: BanquetBookingStatus,
    stamps: Prisma.BanquetBookingUncheckedUpdateInput,
    action: string,
  ): Promise<BookingRecord> {
    return this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, bookingId);
      assertBookingTransition(current.status, to);

      // Conditional on the status we validated: a lost race becomes a 409
      // rather than a double-apply.
      const { count } = await tx.banquetBooking.updateMany({
        where: { id: current.id, status: current.status },
        data: { ...stamps, status: to },
      });
      if (count !== 1) throw new ConflictException('Booking was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, current.id, {
        action,
        previous_status: current.status,
        new_status: to,
      });
      return this.reload(tx, current.id);
    });
  }

  // ── Payments (advance & balance) ──────────────────────────────────────────

  /**
   * Record an advance or balance payment. Append-only by construction: there
   * is no update or delete path here, and the database rejects both anyway.
   *
   * Money rules enforced in one transaction:
   *   - the currency must match the booking's snapshot exactly;
   *   - the amount is whole minor units and at least 1;
   *   - it may not exceed the outstanding balance (no overpayment, no refund
   *     path, no negative amounts);
   *   - a cancelled booking takes no money.
   * The balance is recomputed from the payment history inside the same
   * transaction, so two concurrent payments cannot both "fit" the same room.
   */
  async createPayment(
    ctx: BanquetActorContext,
    bookingId: string,
    dto: CreatePaymentDto,
  ): Promise<{ payment: BanquetPaymentView; balance: BanquetBalanceView }> {
    const currency = assertCurrencyCode(dto.currency);
    const paidAt = dto.paid_at ? this.parseInstant(dto.paid_at, 'paid_at') : new Date();

    return this.mutate(async (tx) => {
      const booking = await this.loadForMutation(tx, ctx, bookingId);
      if (booking.status === BanquetBookingStatus.CANCELLED) {
        throw new ConflictException('A cancelled booking cannot take a payment');
      }
      if (currency !== booking.currency) {
        throw new ConflictException(
          `Payment currency ${currency} does not match the booking currency ${booking.currency}`,
        );
      }

      // SERIALISE FIRST, THEN READ.
      //
      // Take an exclusive lock on the booking row before looking at the
      // payment history. Under PostgreSQL's default READ COMMITTED isolation,
      // concurrent payment transactions would otherwise each read the same
      // history, each compute the same outstanding balance, and each decide it
      // had room — six payments of 40% could all be accepted against one
      // total. Locking here makes the read-check-insert sequence atomic per
      // booking, so the balance a payment is validated against is the one that
      // will still be true at commit.
      //
      // Prisma has no row-lock API, so this is raw SQL. It selects nothing
      // useful on purpose: the lock is the point.
      await tx.$queryRaw`SELECT "id" FROM "banquet_bookings" WHERE "id" = ${booking.id}::uuid FOR UPDATE`;

      const existing = await tx.banquetPayment.findMany({
        where: { booking_id: booking.id },
        select: { amount_minor: true },
      });
      const paid = sumPaidMinor(existing);
      const outstanding = balanceMinor(booking.total_amount_minor, paid);
      if (dto.amount_minor > outstanding) {
        throw new ConflictException(
          `Payment of ${dto.amount_minor} exceeds the outstanding balance of ${outstanding}`,
        );
      }

      const payment = await tx.banquetPayment.create({
        data: {
          booking_id: booking.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          amount_minor: dto.amount_minor,
          currency,
          paid_at: paidAt,
          method: dto.method ?? null,
          reference: dto.reference ?? null,
          actor_user_id: ctx.actorUserId,
        },
      });

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_PAYMENT, payment.id, {
        action: 'create_payment',
        booking_id: booking.id,
        amount_minor: dto.amount_minor,
        currency,
        // Only whether a reference was supplied — never the reference itself.
        has_reference: dto.reference !== undefined,
        method: dto.method ?? null,
      });

      const newPaid = paid + dto.amount_minor;
      return {
        payment: this.toPaymentView(payment),
        balance: this.toBalance(booking.total_amount_minor, newPaid, booking.currency),
      };
    });
  }

  // ── Event plan ────────────────────────────────────────────────────────────

  /**
   * Create or replace the operational plan for a booking. One row per booking,
   * three fields: when service is, how the room is set, what the kitchen needs
   * to know. A task/checklist system is Phase 9 and is deliberately absent.
   */
  async upsertEventPlan(
    ctx: BanquetActorContext,
    bookingId: string,
    dto: UpsertEventPlanDto,
  ): Promise<BanquetEventPlanView> {
    const serviceAt =
      dto.service_at === undefined || dto.service_at === null
        ? null
        : this.parseInstant(dto.service_at, 'service_at');

    const { plan, booking } = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, bookingId);
      if (current.status === BanquetBookingStatus.CANCELLED) {
        throw new ConflictException('A cancelled booking has no event plan');
      }

      const data = {
        service_at: serviceAt,
        setup_notes: dto.setup_notes ?? null,
        kitchen_notes: dto.kitchen_notes ?? null,
      };
      const saved = await tx.banquetEventPlan.upsert({
        where: { booking_id: current.id },
        create: { booking_id: current.id, ...data },
        update: data,
      });

      await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_EVENT_PLAN, saved.id, {
        action: 'upsert_event_plan',
        booking_id: current.id,
        has_service_at: serviceAt !== null,
        changed_fields: Object.keys(dto),
      });
      return { plan: saved, booking: await this.reload(tx, current.id) };
    });

    // The kitchen cares about service time and kitchen notes.
    this.publish(ctx, BANQUET_EVENT_TYPES.EVENT_PLAN_UPDATED, booking);
    return this.toEventPlanView(plan);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Every mutation runs here: one transaction owns the row, its audit record
   * and any child rows, domain errors become controlled HTTP responses, and
   * nothing is published until the callback has returned — i.e. after commit.
   */
  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      if (e instanceof InvalidBookingTransitionError) throw new ConflictException(e.message);
      if (this.isHallOverlap(e)) {
        throw new ConflictException(
          'That hall is already booked for an overlapping time. Choose another hall or time.',
        );
      }
      if (this.isTimeOrderViolation(e)) {
        throw new BadRequestException('ends_at must be after starts_at');
      }
      throw e;
    }
  }

  /** The exclusion constraint banquet_bookings_hall_no_overlap fired. */
  private isHallOverlap(e: unknown): boolean {
    const message =
      e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Error ? e.message : '';
    return /banquet_bookings_hall_no_overlap|exclusion constraint/i.test(message);
  }

  private isTimeOrderViolation(e: unknown): boolean {
    const message = e instanceof Error ? e.message : '';
    return /banquet_bookings_time_order/i.test(message);
  }

  /** Scoped by id, branch AND company in one query; 404 for anything else. */
  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ctx: BanquetActorContext,
    bookingId: string,
  ): Promise<BookingRecord> {
    const booking = await tx.banquetBooking.findFirst({
      where: { id: bookingId, branch_id: ctx.branchId, company_id: ctx.companyId },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException();
    return booking;
  }

  private reload(tx: Prisma.TransactionClient, bookingId: string): Promise<BookingRecord> {
    return tx.banquetBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
  }

  /** A hall must belong to this branch, be ACTIVE, and seat the party. */
  private async resolveHall(
    tx: Prisma.TransactionClient,
    branchId: string,
    hallId: string,
    guestCount: number,
  ): Promise<{ id: string; capacity: number }> {
    const hall = await tx.banquetHall.findFirst({
      where: { id: hallId, branch_id: branchId },
      select: { id: true, status: true, capacity: true },
    });
    if (!hall) throw new NotFoundException('Hall not found');
    if (hall.status !== BanquetHallStatus.ACTIVE) {
      throw new ConflictException('Hall is not active');
    }
    if (guestCount > hall.capacity) {
      throw new ConflictException(
        `The party of ${guestCount} exceeds this hall's capacity of ${hall.capacity}`,
      );
    }
    return { id: hall.id, capacity: hall.capacity };
  }

  private parseInstant(value: string, field: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO-8601 instant`);
    }
    return d;
  }

  private parseWindow(start: string, end: string): { startsAt: Date; endsAt: Date } {
    const startsAt = this.parseInstant(start, 'starts_at');
    const endsAt = this.parseInstant(end, 'ends_at');
    if (endsAt <= startsAt) {
      throw new BadRequestException('ends_at must be after starts_at');
    }
    return { startsAt, endsAt };
  }

  private audit(
    tx: Prisma.TransactionClient,
    ctx: BanquetActorContext,
    eventType: AuditEventType,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.auditLogService.create(
      {
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        eventType,
        entityType,
        entityId,
        payload,
      },
      tx,
    );
  }

  /** Called ONLY with a committed record. Publishes the chef-safe projection. */
  private publish(ctx: BanquetActorContext, type: string, booking: BookingRecord): void {
    const scope: RealtimeScope = {
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      channel: RealtimeChannel.BANQUET_KDS,
    };
    this.broker.publish(scope, type, this.toChefView(booking));
  }

  private emitAndDetail(
    ctx: BanquetActorContext,
    type: string,
    booking: BookingRecord,
  ): BanquetBookingDetailView {
    this.publish(ctx, type, booking);
    return this.toDetailView(booking);
  }

  // ── Projections ───────────────────────────────────────────────────────────

  toBookingView(booking: BookingRecord): BanquetBookingView {
    return {
      id: booking.id,
      company_id: booking.company_id,
      branch_id: booking.branch_id,
      customer_id: booking.customer_id,
      customer: booking.customer ? { id: booking.customer.id, name: booking.customer.name } : null,
      hall_id: booking.hall_id,
      hall: booking.hall
        ? { id: booking.hall.id, name: booking.hall.name, capacity: booking.hall.capacity }
        : null,
      package_id: booking.package_id,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      guest_count: booking.guest_count,
      status: booking.status,
      package_name: booking.package_name,
      price_per_guest_minor: booking.price_per_guest_minor,
      currency: booking.currency,
      total_amount_minor: booking.total_amount_minor,
      notes: booking.notes,
      confirmed_at: booking.confirmed_at,
      completed_at: booking.completed_at,
      cancelled_at: booking.cancelled_at,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
    };
  }

  toDetailView(booking: BookingRecord): BanquetBookingDetailView {
    const paid = sumPaidMinor(booking.payments);
    return {
      ...this.toBookingView(booking),
      items: booking.items.map((i) => this.toItemView(i)),
      payments: booking.payments.map((p) => this.toPaymentView(p)),
      balance: this.toBalance(booking.total_amount_minor, paid, booking.currency),
      event_plan: booking.event_plan ? this.toEventPlanView(booking.event_plan) : null,
    };
  }

  toChefView(booking: BookingRecord): ChefBookingView {
    return {
      id: booking.id,
      branch_id: booking.branch_id,
      hall_name: booking.hall?.name ?? '',
      guest_count: booking.guest_count,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      service_at: booking.event_plan?.service_at ?? null,
      kitchen_notes: booking.event_plan?.kitchen_notes ?? null,
      status: booking.status,
      items: booking.items.map((i) => this.toItemView(i)),
    };
  }

  private toItemView(item: BookingRecord['items'][number]): BanquetBookingItemView {
    return {
      id: item.id,
      name: item.name,
      position: item.position,
      kds_status: item.kds_status,
      started_at: item.started_at,
      ready_at: item.ready_at,
    };
  }

  private toPaymentView(payment: BookingRecord['payments'][number]): BanquetPaymentView {
    return {
      id: payment.id,
      booking_id: payment.booking_id,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      paid_at: payment.paid_at,
      method: payment.method,
      reference: payment.reference,
      actor_user_id: payment.actor_user_id,
      created_at: payment.created_at,
    };
  }

  private toEventPlanView(plan: NonNullable<BookingRecord['event_plan']>): BanquetEventPlanView {
    return {
      id: plan.id,
      booking_id: plan.booking_id,
      service_at: plan.service_at,
      setup_notes: plan.setup_notes,
      kitchen_notes: plan.kitchen_notes,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
    };
  }

  /** Balance is ALWAYS derived here — there is no stored balance column. */
  private toBalance(totalMinor: number, paidMinor: number, currency: string): BanquetBalanceView {
    const balance = balanceMinor(totalMinor, paidMinor);
    return {
      currency,
      total_amount_minor: totalMinor,
      paid_minor: paidMinor,
      balance_minor: balance,
      fully_paid: balance === 0,
    };
  }
}

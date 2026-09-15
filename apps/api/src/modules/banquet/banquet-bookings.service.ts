import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  BanquetAdjustmentKind,
  BanquetBookingStatus,
  BanquetHallStatus,
  BanquetPackageStatus,
  CustomerStatus,
  Prisma,
} from '@samco/database';
import { PrismaService } from '../../core/database/prisma.service.js';
import { AuditLogService } from '../audit-logs/audit-logs.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import {
  PERMISSION_KEYS,
  type PermissionKey,
} from '../../common/authorization/permission-keys.js';
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
  activeAdjustments,
  assertCurrencyCode,
  balanceMinor,
  paymentKindFor,
  paymentStatusOf,
  priceBooking,
  sumPaidMinor,
  type BanquetInvoice,
} from './banquet-money.js';
import type {
  BanquetAdjustmentView,
  BanquetBalanceView,
  BanquetBillView,
  BanquetBookingDetailView,
  BanquetBookingItemView,
  BanquetBookingView,
  BanquetEventPlanView,
  BanquetPaymentView,
  ChefBookingView,
} from './banquet-views.js';
import type {
  CreateAdjustmentDto,
  CreateBookingDto,
  CreatePaymentDto,
  ListBookingsQueryDto,
  UpdateBookingDto,
  UpsertEventPlanDto,
  VerifyPaymentDto,
} from './banquet.dto.js';

/**
 * Realtime event types published on the `banquet-kds` channel. Every payload
 * is a ChefBookingView — safe for a kitchen screen (see banquet-views.ts).
 */
export const BANQUET_EVENT_TYPES = {
  BOOKING_CONFIRMED: 'banquet.booking.confirmed',
  BOOKING_UPDATED: 'banquet.booking.updated',
  BOOKING_CANCELLED: 'banquet.booking.cancelled',
  BOOKING_COMPLETED: 'banquet.booking.completed',
  EVENT_PLAN_UPDATED: 'banquet.event_plan.updated',
  ITEM_UPDATED: 'banquet.item.updated',
  /** Payload is { id, booking_id, status } — no dish text, no customer. */
  PLATE_REQUEST_UPDATED: 'banquet.plate_request.updated',
} as const;

const AUDIT_BOOKING = 'BANQUET_BOOKING';
const AUDIT_PAYMENT = 'BANQUET_PAYMENT';
const AUDIT_PAYMENT_VERIFICATION = 'BANQUET_PAYMENT_VERIFICATION';
const AUDIT_ADJUSTMENT = 'BANQUET_BOOKING_ADJUSTMENT';
const AUDIT_EVENT_PLAN = 'BANQUET_EVENT_PLAN';

export const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true } },
  hall: { select: { id: true, name: true, capacity: true } },
  items: { orderBy: { position: 'asc' } },
  payments: {
    orderBy: [{ paid_at: 'asc' }, { created_at: 'asc' }],
    include: { verification: true },
  },
  adjustments: { orderBy: [{ created_at: 'asc' }, { id: 'asc' }] },
  event_plan: true,
} satisfies Prisma.BanquetBookingInclude;

export type BookingRecord = Prisma.BanquetBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

type PaymentRecord = BookingRecord['payments'][number];
type AdjustmentRecord = BookingRecord['adjustments'][number];

/**
 * Who may add or withdraw each kind of pricing line. Discounts are separately
 * permissioned because that is where revenue leaks.
 */
export const ADJUSTMENT_PERMISSION: Readonly<Record<BanquetAdjustmentKind, PermissionKey>> = {
  [BanquetAdjustmentKind.EXTRA_CHARGE]: PERMISSION_KEYS.BANQUET_CHARGE_MANAGE,
  [BanquetAdjustmentKind.LINE_DISCOUNT]: PERMISSION_KEYS.BANQUET_DISCOUNT_APPLY,
  [BanquetAdjustmentKind.PER_HEAD_DISCOUNT]: PERMISSION_KEYS.BANQUET_DISCOUNT_APPLY,
  [BanquetAdjustmentKind.ADMIN_DISCOUNT]: PERMISSION_KEYS.BANQUET_DISCOUNT_ADMIN,
};

/** Any of these lets a caller reach the adjustment routes; the kind decides the rest. */
export const ADJUSTMENT_ROUTE_PERMISSIONS = [
  PERMISSION_KEYS.BANQUET_CHARGE_MANAGE,
  PERMISSION_KEYS.BANQUET_DISCOUNT_APPLY,
  PERMISSION_KEYS.BANQUET_DISCOUNT_ADMIN,
] as const;

@Injectable()
export class BanquetBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Inject(EVENT_BROKER) private readonly broker: EventBroker,
    private readonly authorization: AuthorizationService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    branchId: string,
    query: ListBookingsQueryDto,
  ): Promise<Paginated<BanquetBookingView>> {
    const now = new Date();
    const where: Prisma.BanquetBookingWhereInput = { branch_id: branchId };
    const and: Prisma.BanquetBookingWhereInput[] = [];

    if (query.status) where.status = query.status;
    if (query.hall_id) where.hall_id = query.hall_id;

    switch (query.tab) {
      case 'drafts':
        and.push({ status: BanquetBookingStatus.DRAFT });
        break;
      case 'upcoming':
        and.push({ status: BanquetBookingStatus.CONFIRMED, starts_at: { gt: now } });
        break;
      case 'past':
        and.push({
          status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
          starts_at: { lte: now },
        });
        break;
      case 'cancelled':
        and.push({ status: BanquetBookingStatus.CANCELLED });
        break;
      default:
        break;
    }

    const total = this.prisma.banquetBooking.fields?.total_amount_minor;
    switch (query.payment) {
      case 'pending':
        and.push({
          status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
          paid_minor: { lt: total },
        });
        break;
      case 'paid':
        and.push({ paid_minor: { gte: total } });
        break;
      case 'unverified':
        and.push({ payments: { some: { verification: { is: null } } } });
        break;
      default:
        break;
    }

    if (query.from || query.to) {
      const range = {
        ...(query.from ? { gte: this.parseInstant(query.from, 'from') } : {}),
        ...(query.to ? { lte: this.parseInstant(query.to, 'to') } : {}),
      };
      const field = query.date_field ?? 'event';
      if (field === 'event') {
        where.starts_at = range;
      } else {
        // "Advance paid in March" / "settled in March": matched against the
        // payment that carries that stage, not the event date.
        and.push({
          payments: { some: { kind: field === 'advance' ? 'ADVANCE' : 'FINAL', paid_at: range } },
        });
      }
    }

    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { customer: { name: contains } },
          { package_name: contains },
          { hall_name: contains },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    const direction = query.tab === 'past' ? 'desc' : 'asc';
    const [rows, count] = await Promise.all([
      this.prisma.banquetBooking.findMany({
        where,
        include: BOOKING_INCLUDE,
        // id breaks ties so paging never repeats or skips a row.
        orderBy: [{ starts_at: direction }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.banquetBooking.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toBookingView(r)),
      meta: { total: count, limit: query.limit, offset: query.offset },
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

  /** The booking plus the branch identity a printed bill carries (GSTIN, FSSAI). */
  async getBill(branchId: string, bookingId: string): Promise<BanquetBillView> {
    const [booking, branch] = await Promise.all([
      this.get(branchId, bookingId),
      this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true, name: true, timezone: true, gstin: true, fssai_license: true, banquet_terms: true },
      }),
    ]);
    if (!branch) throw new NotFoundException();
    return { booking, branch };
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
   * The package's commercial terms and component list, the hall's name and the
   * branch's GST rate are SNAPSHOTTED here, so editing any of them afterwards
   * can never change what this event meant or cost.
   */
  async create(ctx: BanquetActorContext, dto: CreateBookingDto): Promise<BanquetBookingDetailView> {
    const { startsAt, endsAt } = this.parseWindow(dto.starts_at, dto.ends_at);
    const extraPax = dto.extra_pax ?? 0;

    const booking = await this.mutate(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customer_id, company_id: ctx.companyId },
        select: { id: true, status: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.status !== CustomerStatus.ACTIVE) {
        throw new ConflictException('Customer is inactive');
      }

      const hall = await this.resolveHall(tx, ctx.branchId, dto.hall_id, dto.guest_count + extraPax);

      const pkg = await tx.banquetPackage.findFirst({
        where: { id: dto.package_id, company_id: ctx.companyId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      if (pkg.status !== BanquetPackageStatus.ACTIVE) {
        throw new ConflictException('Package is inactive');
      }

      const currency = assertCurrencyCode(pkg.currency);
      const gstRate = dto.apply_gst === false ? 0 : await this.branchGstRate(tx, ctx.branchId);
      const invoice = priceBooking({
        price_per_guest_minor: pkg.price_per_guest_minor,
        guest_count: dto.guest_count,
        extra_pax: extraPax,
        gst_rate_bps: gstRate,
        adjustments: [],
      });

      const created = await tx.banquetBooking.create({
        data: {
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          customer_id: customer.id,
          hall_id: hall.id,
          hall_name: hall.name,
          package_id: pkg.id,
          starts_at: startsAt,
          ends_at: endsAt,
          guest_count: dto.guest_count,
          extra_pax: extraPax,
          status: INITIAL_BOOKING_STATUS,
          // Commercial snapshot — fixed for the life of the booking.
          package_name: pkg.name,
          price_per_guest_minor: pkg.price_per_guest_minor,
          currency,
          gst_rate_bps: gstRate,
          total_amount_minor: invoice.total_minor,
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
        extra_pax: extraPax,
        gst_rate_bps: gstRate,
        total_amount_minor: invoice.total_minor,
        currency,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });
      return created;
    });

    // A draft is invisible to the kitchen, so nothing is published yet.
    return this.toDetailView(booking);
  }

  /**
   * Edit a DRAFT or CONFIRMED booking. Re-prices from the snapshot, never from
   * the live package. Rules, all inside one transaction holding the row lock:
   *
   *   - an event that has already started needs banquet.booking.edit_past;
   *   - the new total may not fall below what has already been paid;
   *   - moving a confirmed booking is still guarded by the hall exclusion
   *     constraint, so an edit cannot double-book a hall either;
   *   - the audit record carries each changed value's old and new state.
   */
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
      const pastEvent = await this.assertMayAlter(ctx, current);

      const startsAt = dto.starts_at ? this.parseInstant(dto.starts_at, 'starts_at') : current.starts_at;
      const endsAt = dto.ends_at ? this.parseInstant(dto.ends_at, 'ends_at') : current.ends_at;
      if (endsAt <= startsAt) {
        throw new BadRequestException('ends_at must be after starts_at');
      }

      const guestCount = dto.guest_count ?? current.guest_count;
      const extraPax = dto.extra_pax ?? current.extra_pax;
      const hallId = dto.hall_id ?? current.hall_id;
      let hallName = current.hall_name ?? current.hall?.name ?? '';
      if (dto.hall_id !== undefined || dto.guest_count !== undefined || dto.extra_pax !== undefined) {
        const hall = await this.resolveHall(tx, ctx.branchId, hallId, guestCount + extraPax);
        if (hall.id !== current.hall_id) hallName = hall.name;
      }

      let gstRate = current.gst_rate_bps;
      if (dto.apply_gst === false) gstRate = 0;
      else if (dto.apply_gst === true) gstRate = await this.branchGstRate(tx, ctx.branchId);

      const invoice = this.price(current, {
        guest_count: guestCount,
        extra_pax: extraPax,
        gst_rate_bps: gstRate,
      });
      this.assertCoversPaid(invoice.total_minor, current);

      const data = {
        starts_at: startsAt,
        ends_at: endsAt,
        guest_count: guestCount,
        extra_pax: extraPax,
        hall_id: hallId,
        hall_name: hallName,
        gst_rate_bps: gstRate,
        total_amount_minor: invoice.total_minor,
      };
      const { count } = await tx.banquetBooking.updateMany({
        where: { id: current.id, status: current.status },
        data: dto.notes !== undefined ? { ...data, notes: dto.notes } : data,
      });
      if (count !== 1) throw new ConflictException('Booking was modified concurrently');

      await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, current.id, {
        action: 'update_booking',
        changed_fields: Object.keys(dto),
        booking_status: current.status,
        past_event: pastEvent,
        // Notes are free text written about a customer: whether they changed,
        // never what they say.
        notes_changed: dto.notes !== undefined && dto.notes !== current.notes,
        changes: this.diff(current, data),
        guest_count: guestCount,
        total_amount_minor: invoice.total_minor,
      });
      return this.reload(tx, current.id);
    });

    // A confirmed event is on the kitchen board: head count and times matter there.
    if (booking.status === BanquetBookingStatus.CONFIRMED) {
      this.publish(ctx, BANQUET_EVENT_TYPES.BOOKING_UPDATED, booking);
    }
    return this.toDetailView(booking);
  }

  // ── Pricing adjustments ───────────────────────────────────────────────────

  /**
   * Add an extra charge or a discount. Append-only: the line is inserted, the
   * booking is re-priced from its snapshot plus every line still in force, and
   * the old and new totals are audited in the same transaction.
   */
  async addAdjustment(
    ctx: BanquetActorContext,
    bookingId: string,
    dto: CreateAdjustmentDto,
  ): Promise<BanquetBookingDetailView> {
    await this.assertMayAdjust(ctx, dto.kind);

    const booking = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, bookingId);
      this.assertPriceable(current);
      const pastEvent = await this.assertMayAlter(ctx, current);

      const created = await tx.banquetBookingAdjustment.create({
        data: {
          booking_id: current.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          kind: dto.kind,
          description: dto.description,
          amount_minor: dto.amount_minor,
          actor_user_id: ctx.actorUserId,
        },
      });
      const total = await this.reprice(tx, current, [...current.adjustments, created]);

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_ADJUSTMENT, created.id, {
        action: 'add_adjustment',
        booking_id: current.id,
        kind: dto.kind,
        amount_minor: dto.amount_minor,
        past_event: pastEvent,
        changes: { total_amount_minor: { from: current.total_amount_minor, to: total } },
      });
      return this.reload(tx, current.id);
    });
    return this.toDetailView(booking);
  }

  /** Withdraw a line by appending its reversal. A line is reversed at most once. */
  async reverseAdjustment(
    ctx: BanquetActorContext,
    bookingId: string,
    adjustmentId: string,
  ): Promise<BanquetBookingDetailView> {
    const booking = await this.mutate(async (tx) => {
      const current = await this.loadForMutation(tx, ctx, bookingId);
      const target = current.adjustments.find((a) => a.id === adjustmentId);
      if (!target) throw new NotFoundException();
      if (target.reverses_id) {
        throw new ConflictException('A withdrawal cannot itself be withdrawn; add a new line instead');
      }
      if (current.adjustments.some((a) => a.reverses_id === target.id)) {
        throw new ConflictException('This line has already been withdrawn');
      }
      await this.assertMayAdjust(ctx, target.kind);
      this.assertPriceable(current);
      const pastEvent = await this.assertMayAlter(ctx, current);

      const reversal = await tx.banquetBookingAdjustment.create({
        data: {
          booking_id: current.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          kind: target.kind,
          description: `Withdrawn: ${target.description}`.slice(0, 200),
          amount_minor: target.amount_minor,
          reverses_id: target.id,
          actor_user_id: ctx.actorUserId,
        },
      });
      const total = await this.reprice(tx, current, [...current.adjustments, reversal]);

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_ADJUSTMENT, reversal.id, {
        action: 'reverse_adjustment',
        booking_id: current.id,
        reverses_id: target.id,
        kind: target.kind,
        amount_minor: target.amount_minor,
        past_event: pastEvent,
        changes: { total_amount_minor: { from: current.total_amount_minor, to: total } },
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

  /**
   * DRAFT|CONFIRMED ─▶ CANCELLED, releasing the hall immediately. Money already
   * taken stays recorded against the booking: there is no refund or voucher
   * path (not defined for this product), and nothing is silently reversed.
   */
  async cancel(
    ctx: BanquetActorContext,
    bookingId: string,
    reason?: string,
  ): Promise<BanquetBookingDetailView> {
    const booking = await this.transition(
      ctx,
      bookingId,
      BanquetBookingStatus.CANCELLED,
      { cancelled_at: new Date(), cancellation_reason: reason ?? null },
      'cancel',
      { has_reason: reason !== undefined },
    );
    return this.emitAndDetail(ctx, BANQUET_EVENT_TYPES.BOOKING_CANCELLED, booking);
  }

  private async transition(
    ctx: BanquetActorContext,
    bookingId: string,
    to: BanquetBookingStatus,
    stamps: Prisma.BanquetBookingUncheckedUpdateInput,
    action: string,
    extraAudit: Record<string, unknown> = {},
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
        ...extraAudit,
      });
      return this.reload(tx, current.id);
    });
  }

  // ── Payments (advance, interim & final) ───────────────────────────────────

  /**
   * Record a payment. Append-only by construction: there is no update or
   * delete path here, and the database rejects both anyway.
   *
   * Money rules enforced in one transaction:
   *   - the currency must match the booking's snapshot exactly;
   *   - the amount is whole minor units and at least 1;
   *   - it may not exceed the outstanding balance (no overpayment, no refund
   *     path, no negative amounts) — and the database CHECK
   *     paid_minor <= total_amount_minor backs that up;
   *   - a cancelled booking takes no money.
   * The settlement stage (advance / interim / final) is decided here, never
   * by the client.
   */
  async createPayment(
    ctx: BanquetActorContext,
    bookingId: string,
    dto: CreatePaymentDto,
  ): Promise<{ payment: BanquetPaymentView; balance: BanquetBalanceView }> {
    const currency = assertCurrencyCode(dto.currency);
    const paidAt = dto.paid_at ? this.parseInstant(dto.paid_at, 'paid_at') : new Date();

    return this.mutate(async (tx) => {
      // loadForMutation takes the row lock FIRST. Under READ COMMITTED,
      // concurrent payment transactions would otherwise each read the same
      // history, each compute the same outstanding balance, and each decide
      // it had room. Locking makes read-check-insert atomic per booking.
      const booking = await this.loadForMutation(tx, ctx, bookingId);
      if (booking.status === BanquetBookingStatus.CANCELLED) {
        throw new ConflictException('A cancelled booking cannot take a payment');
      }
      if (currency !== booking.currency) {
        throw new ConflictException(
          `Payment currency ${currency} does not match the booking currency ${booking.currency}`,
        );
      }

      // The history is the source of truth for what has been paid; the
      // stored paid_minor is refreshed from it below.
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
      const kind = paymentKindFor(paid, dto.amount_minor, booking.total_amount_minor);

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
          kind,
          actor_user_id: ctx.actorUserId,
        },
        include: { verification: true },
      });
      const newPaid = paid + dto.amount_minor;
      await tx.banquetBooking.update({
        where: { id: booking.id },
        data: { paid_minor: newPaid },
      });

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_PAYMENT, payment.id, {
        action: 'create_payment',
        booking_id: booking.id,
        amount_minor: dto.amount_minor,
        currency,
        kind,
        // Only whether a reference was supplied — never the reference itself.
        has_reference: dto.reference !== undefined,
        method: dto.method ?? null,
        changes: { paid_minor: { from: paid, to: newPaid } },
      });

      return {
        payment: this.toPaymentView(payment),
        balance: this.toBalance(booking.total_amount_minor, newPaid, booking.currency),
      };
    });
  }

  /**
   * Second-person verification that a recorded payment was received. The
   * recorder can never verify their own payment, and a payment is verified
   * once (a unique index settles two verifiers racing).
   */
  async verifyPayment(
    ctx: BanquetActorContext,
    paymentId: string,
    dto: VerifyPaymentDto,
  ): Promise<BanquetPaymentView> {
    return this.mutate(async (tx) => {
      const payment = await tx.banquetPayment.findFirst({
        where: { id: paymentId, branch_id: ctx.branchId, company_id: ctx.companyId },
        include: { verification: true },
      });
      if (!payment) throw new NotFoundException();
      if (payment.verification) {
        throw new ConflictException('This payment has already been verified');
      }
      if (payment.actor_user_id === ctx.actorUserId) {
        throw new ForbiddenException('A payment cannot be verified by the person who recorded it');
      }

      const verification = await tx.banquetPaymentVerification.create({
        data: {
          payment_id: payment.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          verified_by_user_id: ctx.actorUserId,
          note: dto.note ?? null,
        },
      });
      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_PAYMENT_VERIFICATION, verification.id, {
        action: 'verify_payment',
        payment_id: payment.id,
        booking_id: payment.booking_id,
        amount_minor: payment.amount_minor,
        currency: payment.currency,
        has_note: dto.note !== undefined,
      });
      return this.toPaymentView({ ...payment, verification });
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
      const message = e instanceof Error ? e.message : '';
      if (/banquet_bookings_hall_no_overlap|exclusion constraint/i.test(message)) {
        throw new ConflictException(
          'That hall is already booked for an overlapping time. Choose another hall or time.',
        );
      }
      if (/banquet_bookings_time_order/i.test(message)) {
        throw new BadRequestException('ends_at must be after starts_at');
      }
      if (/banquet_bookings_paid_within_total/i.test(message)) {
        throw new ConflictException('The booking total cannot be less than the amount already paid');
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This change has already been made');
      }
      throw e;
    }
  }

  /**
   * Scoped by id, branch AND company; 404 for anything else. Takes the row
   * lock first, so every mutation of one booking — edits, adjustments,
   * payments, transitions — is serialised and each sees the committed state
   * of the one before it. The lock query itself is tenant-scoped, so a caller
   * can never lock another branch's row.
   */
  private async loadForMutation(
    tx: Prisma.TransactionClient,
    ctx: BanquetActorContext,
    bookingId: string,
  ): Promise<BookingRecord> {
    await tx.$queryRaw`
      SELECT "id" FROM "banquet_bookings"
      WHERE "id" = ${bookingId}::uuid
        AND "branch_id" = ${ctx.branchId}::uuid
        AND "company_id" = ${ctx.companyId}::uuid
      FOR UPDATE`;
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
    headCount: number,
  ): Promise<{ id: string; name: string; capacity: number }> {
    const hall = await tx.banquetHall.findFirst({
      where: { id: hallId, branch_id: branchId },
      select: { id: true, name: true, status: true, capacity: true },
    });
    if (!hall) throw new NotFoundException('Hall not found');
    if (hall.status !== BanquetHallStatus.ACTIVE) {
      throw new ConflictException('Hall is not active');
    }
    if (headCount > hall.capacity) {
      throw new ConflictException(
        `The party of ${headCount} exceeds this hall's capacity of ${hall.capacity}`,
      );
    }
    return { id: hall.id, name: hall.name, capacity: hall.capacity };
  }

  private async branchGstRate(tx: Prisma.TransactionClient, branchId: string): Promise<number> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { banquet_gst_rate_bps: true },
    });
    return branch?.banquet_gst_rate_bps ?? 0;
  }

  /** Only a live booking's price can change; history is closed. */
  private assertPriceable(booking: BookingRecord): void {
    if (!isEditable(booking.status)) {
      throw new ConflictException(
        `A ${booking.status.toLowerCase()} booking can no longer be re-priced`,
      );
    }
  }

  /**
   * Revenue-integrity control: once an event has started, changing it needs
   * banquet.booking.edit_past. Returns whether the event is in the past, for
   * the audit record.
   */
  private async assertMayAlter(ctx: BanquetActorContext, booking: BookingRecord): Promise<boolean> {
    if (booking.starts_at.getTime() > Date.now()) return false;
    const allowed = await this.authorization.hasBranchPermission(
      ctx.actorUserId,
      ctx.companyId,
      ctx.branchId,
      PERMISSION_KEYS.BANQUET_BOOKING_EDIT_PAST,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'This event has already started. Changing it requires the banquet.booking.edit_past permission.',
      );
    }
    return true;
  }

  private async assertMayAdjust(ctx: BanquetActorContext, kind: BanquetAdjustmentKind): Promise<void> {
    const permission = ADJUSTMENT_PERMISSION[kind];
    const allowed = await this.authorization.hasBranchPermission(
      ctx.actorUserId,
      ctx.companyId,
      ctx.branchId,
      permission,
    );
    if (!allowed) {
      throw new ForbiddenException(`Adding or withdrawing a ${kind.toLowerCase()} requires ${permission}`);
    }
  }

  private price(
    booking: BookingRecord,
    over: Partial<{ guest_count: number; extra_pax: number; gst_rate_bps: number }> = {},
    adjustments: ReadonlyArray<AdjustmentRecord> = booking.adjustments,
  ): BanquetInvoice {
    return priceBooking({
      price_per_guest_minor: booking.price_per_guest_minor,
      guest_count: over.guest_count ?? booking.guest_count,
      extra_pax: over.extra_pax ?? booking.extra_pax,
      gst_rate_bps: over.gst_rate_bps ?? booking.gst_rate_bps,
      adjustments,
    });
  }

  private async reprice(
    tx: Prisma.TransactionClient,
    booking: BookingRecord,
    adjustments: ReadonlyArray<AdjustmentRecord>,
  ): Promise<number> {
    const invoice = this.price(booking, {}, adjustments);
    this.assertCoversPaid(invoice.total_minor, booking);
    await tx.banquetBooking.update({
      where: { id: booking.id },
      data: { total_amount_minor: invoice.total_minor },
    });
    return invoice.total_minor;
  }

  /** Money already taken is never silently turned into an overpayment. */
  private assertCoversPaid(totalMinor: number, booking: BookingRecord): void {
    const paid = sumPaidMinor(booking.payments);
    if (totalMinor < paid) {
      throw new ConflictException(
        `This change would make the total ${totalMinor}, less than the ${paid} already paid`,
      );
    }
  }

  /** Old → new for every value that actually changed; instants as ISO strings. */
  private diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, to] of Object.entries(after)) {
      const from = norm(before[key]);
      if (from !== norm(to)) changes[key] = { from, to: norm(to) };
    }
    return changes;
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
    const paid = sumPaidMinor(booking.payments);
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
      hall_name: booking.hall_name ?? booking.hall?.name ?? '',
      package_id: booking.package_id,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      guest_count: booking.guest_count,
      extra_pax: booking.extra_pax,
      status: booking.status,
      package_name: booking.package_name,
      price_per_guest_minor: booking.price_per_guest_minor,
      currency: booking.currency,
      gst_rate_bps: booking.gst_rate_bps,
      total_amount_minor: booking.total_amount_minor,
      paid_minor: paid,
      payment_status: paymentStatusOf(booking.total_amount_minor, paid),
      notes: booking.notes,
      cancellation_reason: booking.cancellation_reason,
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
      adjustments: booking.adjustments.map((a) => this.toAdjustmentView(a, booking.adjustments)),
      invoice: this.price(booking),
      balance: this.toBalance(booking.total_amount_minor, paid, booking.currency),
      event_plan: booking.event_plan ? this.toEventPlanView(booking.event_plan) : null,
    };
  }

  toChefView(booking: BookingRecord): ChefBookingView {
    return {
      id: booking.id,
      branch_id: booking.branch_id,
      hall_name: booking.hall_name ?? booking.hall?.name ?? '',
      guest_count: booking.guest_count + (booking.extra_pax ?? 0),
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

  private toPaymentView(payment: PaymentRecord): BanquetPaymentView {
    return {
      id: payment.id,
      booking_id: payment.booking_id,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      paid_at: payment.paid_at,
      method: payment.method,
      reference: payment.reference,
      kind: payment.kind ?? null,
      actor_user_id: payment.actor_user_id,
      verification: payment.verification
        ? {
            verified_by_user_id: payment.verification.verified_by_user_id,
            verified_at: payment.verification.verified_at,
            note: payment.verification.note,
          }
        : null,
      created_at: payment.created_at,
    };
  }

  private toAdjustmentView(
    adjustment: AdjustmentRecord,
    all: ReadonlyArray<AdjustmentRecord>,
  ): BanquetAdjustmentView {
    const reversal = all.find((a) => a.reverses_id === adjustment.id) ?? null;
    return {
      id: adjustment.id,
      kind: adjustment.kind,
      description: adjustment.description,
      amount_minor: adjustment.amount_minor,
      reverses_id: adjustment.reverses_id,
      reversed_by_id: reversal?.id ?? null,
      active: activeAdjustments(all).some((a) => a.id === adjustment.id),
      actor_user_id: adjustment.actor_user_id,
      created_at: adjustment.created_at,
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

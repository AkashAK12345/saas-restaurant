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
import { branchLocalToInstant } from '../../common/scheduler/branch-time.js';
import { addDays, isCalendarDate } from './banquet-catalog.service.js';
import type { Paginated } from '../../common/pagination.dto.js';
import type { BanquetActorContext } from './banquet-context.js';
import {
  HALL_OCCUPYING_STATUSES,
  INITIAL_BOOKING_STATUS,
  InvalidBookingTransitionError,
  assertBookingTransition,
  isEditable,
} from './banquet-state-machine.js';
import {
  activeAdjustments,
  activePayments,
  assertCurrencyCode,
  balanceMinor,
  paymentKindFor,
  paymentStatusOf,
  priceBooking,
  sumPaidMinor,
  type BanquetInvoice,
  type BanquetPaymentStatusName,
} from './banquet-money.js';
import type {
  BanquetAdjustmentView,
  BanquetBalanceView,
  BanquetBillView,
  BanquetBookingDetailView,
  BanquetBookingItemView,
  BanquetBookingView,
  BanquetBookingPhotoView,
  BanquetEventPlanView,
  BanquetFinanceView,
  BanquetPaymentView,
  ChefBookingView,
  FinanceBookingRow,
} from './banquet-views.js';
import type {
  CreateAdjustmentDto,
  CreateBookingDto,
  CreatePaymentDto,
  FinanceQueryDto,
  ListBookingsQueryDto,
  UpdateBookingDto,
  UpdatePaymentDto,
  UploadBookingPhotoDto,
  UpsertEventPlanDto,
  VerifyPaymentDto,
} from './banquet.dto.js';
import { MAX_BOOKING_PHOTOS, MAX_PHOTO_SIZE_BYTES } from './banquet.dto.js';

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

/** Longest range the finance overview answers in one request (a year). */
export const MAX_FINANCE_DAYS = 366;

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
    const advance = dto.initial_payment;
    if (advance) {
      const mayPay = await this.authorization.hasBranchPermission(
        ctx.actorUserId,
        ctx.companyId,
        ctx.branchId,
        PERMISSION_KEYS.BANQUET_PAYMENT_CREATE,
      );
      if (!mayPay) {
        throw new ForbiddenException('Recording an advance requires banquet.payment.create');
      }
    }

    const { booking, confirmed } = await this.mutate(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customer_id, company_id: ctx.companyId },
        select: { id: true, status: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.status !== CustomerStatus.ACTIVE) {
        throw new ConflictException('Customer is inactive');
      }

      const hall = await this.resolveHall(tx, ctx.branchId, dto.hall_id, dto.guest_count + extraPax);
      await this.assertCustomerFree(tx, ctx, customer.id, startsAt, endsAt);

      let pkgId: string | null = null;
      let pkgName = '';
      let pricePerGuest = 0;
      let currency = 'INR';
      let pkgItems: Array<{ name: string; position: number }> = [];

      if (dto.package_id) {
        const pkg = await tx.banquetPackage.findFirst({
          where: { id: dto.package_id, company_id: ctx.companyId },
          include: { items: { orderBy: { position: 'asc' } } },
        });
        if (!pkg) throw new NotFoundException('Package not found');
        if (pkg.status !== BanquetPackageStatus.ACTIVE) {
          throw new ConflictException('Package is inactive');
        }
        pkgId = pkg.id;
        pkgName = pkg.name;
        pricePerGuest = pkg.price_per_guest_minor;
        currency = assertCurrencyCode(pkg.currency);
        pkgItems = pkg.items.map((item) => ({ name: item.name, position: item.position }));
      }

      const gstRate = dto.apply_gst === false ? 0 : await this.branchGstRate(tx, ctx.branchId);
      const invoice = priceBooking({
        price_per_guest_minor: pricePerGuest,
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
          package_id: pkgId,
          starts_at: startsAt,
          ends_at: endsAt,
          guest_count: dto.guest_count,
          extra_pax: extraPax,
          status: INITIAL_BOOKING_STATUS,
          package_name: pkgName,
          price_per_guest_minor: pricePerGuest,
          currency,
          gst_rate_bps: gstRate,
          total_amount_minor: invoice.total_minor,
          notes: dto.notes ?? null,
          ...(pkgItems.length > 0
            ? { items: { create: pkgItems } }
            : {}),
        },
        include: BOOKING_INCLUDE,
      });

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_BOOKING, created.id, {
        action: 'create_booking',
        hall_id: hall.id,
        package_id: pkgId,
        guest_count: dto.guest_count,
        extra_pax: extraPax,
        gst_rate_bps: gstRate,
        total_amount_minor: invoice.total_minor,
        currency,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      });

      if (!advance) return { booking: created, confirmed: false };

      // Refused inside the transaction, so a bad advance never leaves a stray
      // draft behind: the booking and its advance succeed or fail together.
      if (pkgId !== null && advance.amount_minor > invoice.total_minor) {
        const major = (minor: number) => (minor / 100).toFixed(2);
        throw new ConflictException(
          `The advance of ${currency} ${major(advance.amount_minor)} is more than the booking total of ` +
            `${currency} ${major(invoice.total_minor)}.`,
        );
      }
      const kind = this.settlementStage(created, 0, advance.amount_minor);
      const payment = await tx.banquetPayment.create({
        data: {
          booking_id: created.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          amount_minor: advance.amount_minor,
          currency,
          paid_at: new Date(),
          method: advance.method || null,
          reference: advance.reference || null,
          kind,
          actor_user_id: ctx.actorUserId,
        },
      });
      const { data, confirmed } = this.autoConfirmUpdate(created, advance.amount_minor);
      await tx.banquetBooking.update({ where: { id: created.id }, data });

      await this.audit(tx, ctx, AuditEventType.CREATE, AUDIT_PAYMENT, payment.id, {
        action: 'create_payment',
        booking_id: created.id,
        amount_minor: advance.amount_minor,
        currency,
        kind,
        has_reference: !!advance.reference,
        method: advance.method || null,
        changes: { paid_minor: { from: 0, to: advance.amount_minor } },
      });
      if (confirmed) {
        await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, created.id, {
          action: 'auto_confirm_on_payment',
          previous_status: created.status,
          new_status: BanquetBookingStatus.CONFIRMED,
          triggering_payment_id: payment.id,
        });
      }
      return { booking: await this.reload(tx, created.id), confirmed };
    });

    // A draft is invisible to the kitchen; a booking confirmed by its advance is not.
    if (confirmed) this.publish(ctx, BANQUET_EVENT_TYPES.BOOKING_CONFIRMED, booking);
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
      await this.assertEditable(ctx, current, 'edited');
      const pastEvent = await this.assertMayAlter(ctx, current);

      const startsAt = dto.starts_at ? this.parseInstant(dto.starts_at, 'starts_at') : current.starts_at;
      const endsAt = dto.ends_at ? this.parseInstant(dto.ends_at, 'ends_at') : current.ends_at;
      if (endsAt <= startsAt) {
        throw new BadRequestException('ends_at must be after starts_at');
      }
      if (dto.starts_at || dto.ends_at) {
        await this.assertCustomerFree(tx, ctx, current.customer_id, startsAt, endsAt, current.id);
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

      // Package (and its items) is snapshotted, exactly like create — picking
      // a new one never reaches back into the live package later.
      let packageId = current.package_id;
      let packageName = current.package_name;
      let pricePerGuest = current.price_per_guest_minor;
      let currency = current.currency;
      let newItems: Array<{ name: string; position: number }> | null = null;

      if (dto.package_id !== undefined) {
        if (dto.package_id === null) {
          packageId = null;
          packageName = '';
          pricePerGuest = 0;
          newItems = [];
        } else {
          const pkg = await tx.banquetPackage.findFirst({
            where: { id: dto.package_id, company_id: ctx.companyId },
            include: { items: { orderBy: { position: 'asc' } } },
          });
          if (!pkg) throw new NotFoundException('Package not found');
          if (pkg.status !== BanquetPackageStatus.ACTIVE) {
            throw new ConflictException('Package is inactive');
          }
          packageId = pkg.id;
          packageName = pkg.name;
          pricePerGuest = pkg.price_per_guest_minor;
          currency = assertCurrencyCode(pkg.currency);
          newItems = pkg.items.map((item) => ({ name: item.name, position: item.position }));
        }
        if (current.items.some((item) => item.started_at !== null)) {
          throw new ConflictException(
            'Cannot change the menu: the kitchen has already started preparing an item from the current one',
          );
        }
      }

      const invoice = priceBooking({
        price_per_guest_minor: pricePerGuest,
        guest_count: guestCount,
        extra_pax: extraPax,
        gst_rate_bps: gstRate,
        adjustments: current.adjustments,
      });
      if (packageId !== null) this.assertCoversPaid(invoice.total_minor, current);

      const data = {
        starts_at: startsAt,
        ends_at: endsAt,
        guest_count: guestCount,
        extra_pax: extraPax,
        hall_id: hallId,
        hall_name: hallName,
        gst_rate_bps: gstRate,
        package_id: packageId,
        package_name: packageName,
        price_per_guest_minor: pricePerGuest,
        currency,
        total_amount_minor: invoice.total_minor,
      };
      const { count } = await tx.banquetBooking.updateMany({
        where: { id: current.id, status: current.status },
        data: dto.notes !== undefined ? { ...data, notes: dto.notes } : data,
      });
      if (count !== 1) throw new ConflictException('Booking was modified concurrently');

      if (newItems !== null) {
        await tx.banquetBookingItem.deleteMany({ where: { booking_id: current.id } });
        if (newItems.length > 0) {
          await tx.banquetBookingItem.createMany({
            data: newItems.map((item) => ({ ...item, booking_id: current.id })),
          });
        }
      }

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
      await this.assertPriceable(ctx, current);
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
      await this.assertPriceable(ctx, current);
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

  /**
   * The hall's lock state is derived from payment, not from a manual confirm
   * click: a DRAFT booking that has taken any money above zero is, by
   * definition, no longer just an enquiry. Mirrors confirm()'s own status
   * write so the same exclusion constraint protects the hall here too.
   */
  private autoConfirmUpdate(
    booking: BookingRecord,
    newPaid: number,
  ): { data: Prisma.BanquetBookingUncheckedUpdateInput; confirmed: boolean } {
    if (booking.status === BanquetBookingStatus.DRAFT && newPaid > 0) {
      assertBookingTransition(booking.status, BanquetBookingStatus.CONFIRMED);
      return {
        data: {
          paid_minor: newPaid,
          status: BanquetBookingStatus.CONFIRMED,
          confirmed_at: new Date(),
        },
        confirmed: true,
      };
    }
    return { data: { paid_minor: newPaid }, confirmed: false };
  }

  /**
   * Delete a booking outright: the row, its menu, photos, plan and its whole
   * payment history go, and the hall is freed if it was held. A DRAFT needs
   * banquet.booking.delete; a CONFIRMED or COMPLETED one — money already
   * taken, possibly an event already held — is a Super-Admin act and also
   * needs banquet.booking.edit_locked. A cancelled booking is refused
   * outright: it already released its hall, and there is nothing left to
   * override.
   *
   * Nothing is lost silently: the booking and every payment are snapshotted
   * into the audit log first, in the same transaction.
   */
  async remove(ctx: BanquetActorContext, bookingId: string): Promise<void> {
    const removed = await this.mutate(async (tx) => {
      const booking = await this.loadForMutation(tx, ctx, bookingId);
      if (
        booking.status === BanquetBookingStatus.CONFIRMED ||
        booking.status === BanquetBookingStatus.COMPLETED
      ) {
        const override = await this.hasEditLockedOverride(ctx);
        if (!override) {
          throw new ForbiddenException(
            `Deleting a ${booking.status.toLowerCase()} booking requires the banquet.booking.edit_locked permission.`,
          );
        }
      } else if (booking.status !== BanquetBookingStatus.DRAFT) {
        throw new ConflictException(
          `A ${booking.status.toLowerCase()} booking cannot be deleted.`,
        );
      }

      await this.audit(tx, ctx, AuditEventType.DELETE, AUDIT_BOOKING, booking.id, {
        action: 'delete_booking',
        booking_status: booking.status,
        customer_id: booking.customer_id,
        hall_id: booking.hall_id,
        hall_name: booking.hall_name,
        starts_at: booking.starts_at.toISOString(),
        ends_at: booking.ends_at.toISOString(),
        guest_count: booking.guest_count,
        package_name: booking.package_name,
        currency: booking.currency,
        total_amount_minor: booking.total_amount_minor,
        paid_minor: sumPaidMinor(activePayments(booking.payments)),
        // The payment history in full, so deleting it never erases the record
        // that the money was taken.
        payments: booking.payments.map((p) => ({
          id: p.id,
          amount_minor: p.amount_minor,
          currency: p.currency,
          kind: p.kind,
          paid_at: p.paid_at.toISOString(),
          method: p.method,
          reverses_id: p.reverses_id,
          actor_user_id: p.actor_user_id,
          verified: !!p.verification,
        })),
      });

      // Lets this transaction — and only this one — past the append-only
      // DELETE guards on payments, verifications and adjustments.
      await tx.$executeRawUnsafe(`SET LOCAL samco.purging_booking = 'on'`);
      await tx.banquetPaymentVerification.deleteMany({
        where: { payment: { booking_id: booking.id } },
      });
      // Reversing rows first: each names the row it reverses.
      await tx.banquetPayment.deleteMany({
        where: { booking_id: booking.id, reverses_id: { not: null } },
      });
      await tx.banquetPayment.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetBookingAdjustment.deleteMany({
        where: { booking_id: booking.id, reverses_id: { not: null } },
      });
      await tx.banquetBookingAdjustment.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetPlateRequest.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetEventPlan.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetBookingPhoto.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetBookingItem.deleteMany({ where: { booking_id: booking.id } });
      await tx.banquetBooking.delete({ where: { id: booking.id } });
      return booking;
    });

    // A confirmed event was on the kitchen board; take it off.
    if (removed.status === BanquetBookingStatus.CONFIRMED) {
      this.publish(ctx, BANQUET_EVENT_TYPES.BOOKING_CANCELLED, removed);
    }
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

    const result = await this.mutate(async (tx) => {
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
        select: { id: true, amount_minor: true, reverses_id: true },
      });
      const paid = sumPaidMinor(activePayments(existing));
      const outstanding = balanceMinor(booking.total_amount_minor, paid);
      if (this.isPriced(booking) && dto.amount_minor > outstanding) {
        throw new ConflictException(
          `Payment of ${dto.amount_minor} exceeds the outstanding balance of ${outstanding}`,
        );
      }
      const kind = this.settlementStage(booking, paid, dto.amount_minor);

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
      const { data, confirmed } = this.autoConfirmUpdate(booking, newPaid);
      await tx.banquetBooking.update({ where: { id: booking.id }, data });

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
      if (confirmed) {
        await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, booking.id, {
          action: 'auto_confirm_on_payment',
          previous_status: booking.status,
          new_status: BanquetBookingStatus.CONFIRMED,
          triggering_payment_id: payment.id,
        });
      }

      return {
        payment: this.toPaymentView(payment),
        balance: this.toBalance(booking, newPaid),
        confirmed,
        reloaded: confirmed ? await this.reload(tx, booking.id) : null,
      };
    });

    if (result.confirmed && result.reloaded) {
      this.publish(ctx, BANQUET_EVENT_TYPES.BOOKING_CONFIRMED, result.reloaded);
    }
    return { payment: result.payment, balance: result.balance };
  }

  /**
   * Correct a mistaken payment. Never an UPDATE — the database trigger on
   * banquet_payments would refuse it anyway — this instead reverses the
   * original (a new row naming it via reverses_id, exactly how a discount is
   * withdrawn) and records a fresh, right payment in the same transaction.
   * The original stays on the record for anyone reading the history; it just
   * stops counting toward paid_minor.
   *
   * Refused once the payment is verified: verification is a second person's
   * confirmation that the amount shown was actually received, and silently
   * swapping it out afterwards would defeat that control.
   */
  async updatePayment(
    ctx: BanquetActorContext,
    bookingId: string,
    paymentId: string,
    dto: UpdatePaymentDto,
  ): Promise<{ payment: BanquetPaymentView; balance: BanquetBalanceView }> {
    const result = await this.mutate(async (tx) => {
      const booking = await this.loadForMutation(tx, ctx, bookingId);
      const original = booking.payments.find((p) => p.id === paymentId);
      if (!original) throw new NotFoundException();
      if (original.reverses_id !== null) {
        throw new ConflictException('This is a correction record itself and cannot be corrected');
      }
      if (!activePayments(booking.payments).some((p) => p.id === original.id)) {
        throw new ConflictException('This payment has already been corrected');
      }
      if (original.verification) {
        throw new ConflictException('A verified payment cannot be corrected');
      }

      const otherPaid = sumPaidMinor(activePayments(booking.payments).filter((p) => p.id !== original.id));
      const outstanding = balanceMinor(booking.total_amount_minor, otherPaid);
      if (this.isPriced(booking) && dto.amount_minor > outstanding) {
        throw new ConflictException(
          `Correction of ${dto.amount_minor} exceeds the outstanding balance of ${outstanding}`,
        );
      }

      await tx.banquetPayment.create({
        data: {
          booking_id: booking.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          amount_minor: original.amount_minor,
          currency: original.currency,
          paid_at: original.paid_at,
          method: original.method,
          reference: original.reference,
          kind: original.kind,
          actor_user_id: ctx.actorUserId,
          reverses_id: original.id,
        },
      });

      const kind = this.settlementStage(booking, otherPaid, dto.amount_minor);
      const corrected = await tx.banquetPayment.create({
        data: {
          booking_id: booking.id,
          company_id: ctx.companyId,
          branch_id: ctx.branchId,
          amount_minor: dto.amount_minor,
          currency: original.currency,
          paid_at: new Date(),
          method: dto.method ?? null,
          reference: dto.reference ?? null,
          kind,
          actor_user_id: ctx.actorUserId,
        },
        include: { verification: true },
      });

      const newPaid = otherPaid + dto.amount_minor;
      const { data, confirmed } = this.autoConfirmUpdate(booking, newPaid);
      await tx.banquetBooking.update({ where: { id: booking.id }, data });

      await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_PAYMENT, original.id, {
        action: 'correct_payment',
        booking_id: booking.id,
        corrected_payment_id: corrected.id,
        from_amount_minor: original.amount_minor,
        to_amount_minor: dto.amount_minor,
        changes: { paid_minor: { from: otherPaid + original.amount_minor, to: newPaid } },
      });
      if (confirmed) {
        await this.audit(tx, ctx, AuditEventType.UPDATE, AUDIT_BOOKING, booking.id, {
          action: 'auto_confirm_on_payment',
          previous_status: booking.status,
          new_status: BanquetBookingStatus.CONFIRMED,
          triggering_payment_id: corrected.id,
        });
      }

      return {
        payment: this.toPaymentView(corrected),
        balance: this.toBalance(booking, newPaid),
        confirmed,
        reloaded: confirmed ? await this.reload(tx, booking.id) : null,
      };
    });

    if (result.confirmed && result.reloaded) {
      this.publish(ctx, BANQUET_EVENT_TYPES.BOOKING_CONFIRMED, result.reloaded);
    }
    return { payment: result.payment, balance: result.balance };
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

  // ── Booking photos ────────────────────────────────────────────────────────

  async listPhotos(branchId: string, bookingId: string): Promise<BanquetBookingPhotoView[]> {
    await this.get(branchId, bookingId);
    const photos = await this.prisma.banquetBookingPhoto.findMany({
      where: { booking_id: bookingId },
      orderBy: { position: 'asc' },
      select: { id: true, booking_id: true, mime_type: true, file_name: true, position: true, created_at: true },
    });
    return photos;
  }

  async getPhotoData(branchId: string, bookingId: string, photoId: string): Promise<{ data: Buffer; mime_type: string; file_name: string | null }> {
    await this.get(branchId, bookingId);
    const photo = await this.prisma.banquetBookingPhoto.findFirst({
      where: { id: photoId, booking_id: bookingId },
    });
    if (!photo) throw new NotFoundException('Photo not found');
    return { data: photo.data, mime_type: photo.mime_type, file_name: photo.file_name };
  }

  async uploadPhoto(ctx: BanquetActorContext, bookingId: string, dto: UploadBookingPhotoDto): Promise<BanquetBookingPhotoView> {
    const buf = Buffer.from(dto.data, 'base64');
    if (buf.length > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestException(`Photo exceeds the ${MAX_PHOTO_SIZE_BYTES / (1024 * 1024)}MB limit`);
    }

    const photo = await this.mutate(async (tx) => {
      const booking = await this.loadForMutation(tx, ctx, bookingId);
      const count = await tx.banquetBookingPhoto.count({ where: { booking_id: booking.id } });
      if (count >= MAX_BOOKING_PHOTOS) {
        throw new ConflictException(`A booking can have at most ${MAX_BOOKING_PHOTOS} photos`);
      }
      return tx.banquetBookingPhoto.create({
        data: {
          booking_id: booking.id,
          data: buf,
          mime_type: dto.mime_type,
          file_name: dto.file_name ?? null,
          position: count,
        },
        select: { id: true, booking_id: true, mime_type: true, file_name: true, position: true, created_at: true },
      });
    });
    return photo;
  }

  async deletePhoto(ctx: BanquetActorContext, bookingId: string, photoId: string): Promise<void> {
    await this.mutate(async (tx) => {
      await this.loadForMutation(tx, ctx, bookingId);
      const photo = await tx.banquetBookingPhoto.findFirst({
        where: { id: photoId, booking_id: bookingId },
        select: { id: true },
      });
      if (!photo) throw new NotFoundException('Photo not found');
      await tx.banquetBookingPhoto.delete({ where: { id: photo.id } });
    });
  }

  // ── Finance ──────────────────────────────────────────────────────────────

  async financeSummary(
    branchId: string,
    query: FinanceQueryDto,
  ): Promise<BanquetFinanceView> {
    if (!isCalendarDate(query.from) || !isCalendarDate(query.to)) {
      throw new BadRequestException('from and to must be real calendar dates');
    }
    if (query.to < query.from) {
      throw new BadRequestException('to must not be before from');
    }
    const dayCount =
      Math.round((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000) + 1;
    if (dayCount > MAX_FINANCE_DAYS) {
      throw new BadRequestException(`Ask for at most ${MAX_FINANCE_DAYS} days at a time`);
    }

    // The range is in the branch's own days: "1–30 Sep" means from midnight
    // on the 1st to midnight after the 30th where the hall is, not in UTC.
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw new NotFoundException();
    const from = branchLocalToInstant(query.from, '00:00', branch.timezone);
    const toExclusive = branchLocalToInstant(addDays(query.to, 1), '00:00', branch.timezone);

    const where: Prisma.BanquetBookingWhereInput = {
      branch_id: branchId,
      starts_at: { gte: from, lt: toExclusive },
    };

    const bookings = await this.prisma.banquetBooking.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        payments: { select: { id: true, amount_minor: true, kind: true, reverses_id: true } },
      },
      // Latest event first, as the finance list reads.
      orderBy: [{ starts_at: 'desc' }, { id: 'asc' }],
    });

    let totalRevenue = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalAdvance = 0;
    let confirmed = 0;
    let completed = 0;
    let cancelled = 0;
    let drafts = 0;
    const eventDates = new Set<string>();

    const rows: FinanceBookingRow[] = [];

    for (const b of bookings) {
      const activeBPayments = activePayments(b.payments);
      const paid = sumPaidMinor(activeBPayments);
      const balance = b.total_amount_minor - paid;
      const status = this.settlementStatus(b, paid);

      switch (b.status) {
        case 'CONFIRMED': confirmed++; break;
        case 'COMPLETED': completed++; break;
        case 'CANCELLED': cancelled++; break;
        case 'DRAFT': drafts++; break;
      }

      if (b.status !== 'CANCELLED') {
        totalRevenue += b.total_amount_minor;
        totalPaid += paid;
        totalOutstanding += Math.max(0, balance);
        eventDates.add(b.starts_at.toISOString().slice(0, 10));
      }

      const advance = activeBPayments
        .filter((p) => p.kind === 'ADVANCE')
        .reduce((s, p) => s + p.amount_minor, 0);
      totalAdvance += advance;

      // The list shows exactly what the totals count: a cancelled booking is
      // neither revenue nor pending, so it is not listed either.
      if (b.status === 'CANCELLED') continue;
      if (query.payment === 'pending' && balance <= 0) continue;

      rows.push({
        id: b.id,
        customer_name: b.customer?.name ?? 'Guest',
        hall_name: b.hall_name ?? '',
        starts_at: b.starts_at,
        guest_count: b.guest_count,
        extra_pax: b.extra_pax,
        status: b.status,
        total_amount_minor: b.total_amount_minor,
        paid_minor: paid,
        balance_minor: Math.max(0, balance),
        remaining_minor: balance,
        payment_status: status,
        currency: b.currency,
      });
    }

    return {
      from: query.from,
      to: query.to,
      currency: 'INR',
      total_bookings: bookings.length,
      confirmed_bookings: confirmed,
      completed_bookings: completed,
      cancelled_bookings: cancelled,
      draft_bookings: drafts,
      total_revenue_minor: totalRevenue,
      total_paid_minor: totalPaid,
      total_outstanding_minor: totalOutstanding,
      total_advance_minor: totalAdvance,
      billable_days: eventDates.size,
      bookings: rows,
    };
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

  /**
   * One customer, one place at a time: a second booking whose window overlaps
   * a live one for the same customer is refused, whichever hall it is in.
   * Another SLOT on the same day is fine — the slots do not overlap.
   */
  private async assertCustomerFree(
    tx: Prisma.TransactionClient,
    ctx: BanquetActorContext,
    customerId: string,
    startsAt: Date,
    endsAt: Date,
    excludeBookingId?: string,
  ): Promise<void> {
    const [clash] = await tx.banquetBooking.findMany({
      where: {
        company_id: ctx.companyId,
        customer_id: customerId,
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        status: { in: [BanquetBookingStatus.DRAFT, ...HALL_OCCUPYING_STATUSES] },
        starts_at: { lt: endsAt },
        ends_at: { gt: startsAt },
      },
      select: { hall_name: true },
      take: 1,
    });
    if (clash) {
      throw new ConflictException(
        `This customer already has a booking in ${clash.hall_name || 'another hall'} at that time.`,
      );
    }
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

  /**
   * Only a live booking, or a completed one held by an edit_locked override,
   * can be changed; a cancelled booking is closed with no override at all.
   */
  private async assertEditable(
    ctx: BanquetActorContext,
    booking: BookingRecord,
    verb: string,
  ): Promise<void> {
    if (isEditable(booking.status)) return;
    if (booking.status === BanquetBookingStatus.COMPLETED && (await this.hasEditLockedOverride(ctx))) {
      return;
    }
    throw new ConflictException(`A ${booking.status.toLowerCase()} booking can no longer be ${verb}`);
  }

  /** Only a live booking's price can change, unless an edit_locked override applies. */
  private async assertPriceable(ctx: BanquetActorContext, booking: BookingRecord): Promise<void> {
    await this.assertEditable(ctx, booking, 're-priced');
  }

  private hasEditLockedOverride(ctx: BanquetActorContext): Promise<boolean> {
    return this.authorization.hasBranchPermission(
      ctx.actorUserId,
      ctx.companyId,
      ctx.branchId,
      PERMISSION_KEYS.BANQUET_BOOKING_EDIT_LOCKED,
    );
  }

  /**
   * Revenue-integrity control: once an event has started, changing it needs
   * banquet.booking.edit_past (or the broader edit_locked override). Returns
   * whether the event is in the past, for the audit record.
   */
  private async assertMayAlter(ctx: BanquetActorContext, booking: BookingRecord): Promise<boolean> {
    if (booking.starts_at.getTime() > Date.now()) return false;
    const allowed =
      (await this.authorization.hasBranchPermission(
        ctx.actorUserId,
        ctx.companyId,
        ctx.branchId,
        PERMISSION_KEYS.BANQUET_BOOKING_EDIT_PAST,
      )) || (await this.hasEditLockedOverride(ctx));
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
    if (this.isPriced(booking)) this.assertCoversPaid(invoice.total_minor, booking);
    await tx.banquetBooking.update({
      where: { id: booking.id },
      data: { total_amount_minor: invoice.total_minor },
    });
    return invoice.total_minor;
  }

  /**
   * A booking with no menu has no price yet, so an advance taken against it
   * can't be measured against its total. Only a priced booking enforces
   * "paid never exceeds the total" (as does the database CHECK).
   */
  private isPriced(booking: { package_id: string | null }): boolean {
    return booking.package_id !== null;
  }

  private settlementStage(
    booking: { package_id: string | null; total_amount_minor: number },
    paidBeforeMinor: number,
    amountMinor: number,
  ): 'ADVANCE' | 'INTERIM' | 'FINAL' {
    if (!this.isPriced(booking)) return paidBeforeMinor === 0 ? 'ADVANCE' : 'INTERIM';
    return paymentKindFor(paidBeforeMinor, amountMinor, booking.total_amount_minor);
  }

  private settlementStatus(
    booking: { package_id: string | null; total_amount_minor: number },
    paidMinor: number,
  ): BanquetPaymentStatusName {
    if (!this.isPriced(booking)) return paidMinor > 0 ? 'PARTIAL' : 'UNPAID';
    return paymentStatusOf(booking.total_amount_minor, paidMinor);
  }

  /** Money already taken is never silently turned into an overpayment. */
  private assertCoversPaid(totalMinor: number, booking: BookingRecord): void {
    const paid = sumPaidMinor(activePayments(booking.payments));
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
    const paid = sumPaidMinor(activePayments(booking.payments));
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
      payment_status: this.settlementStatus(booking, paid),
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
    const paid = sumPaidMinor(activePayments(booking.payments));
    return {
      ...this.toBookingView(booking),
      items: booking.items.map((i) => this.toItemView(i)),
      payments: booking.payments.map((p) => this.toPaymentView(p, booking.payments)),
      adjustments: booking.adjustments.map((a) => this.toAdjustmentView(a, booking.adjustments)),
      invoice: this.price(booking),
      balance: this.toBalance(booking, paid),
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

  private toPaymentView(
    payment: PaymentRecord,
    all: ReadonlyArray<PaymentRecord> = [payment],
  ): BanquetPaymentView {
    const reversal = all.find((p) => p.reverses_id === payment.id) ?? null;
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
      reverses_id: payment.reverses_id,
      reversed_by_id: reversal?.id ?? null,
      active: activePayments(all).some((p) => p.id === payment.id),
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

  private toBalance(
    booking: { package_id: string | null; total_amount_minor: number; currency: string },
    paidMinor: number,
  ): BanquetBalanceView {
    const priced = this.isPriced(booking);
    // An unpriced booking can hold more than its (zero) total; nothing is owed yet.
    const balance = Math.max(0, balanceMinor(booking.total_amount_minor, paidMinor));
    return {
      currency: booking.currency,
      total_amount_minor: booking.total_amount_minor,
      paid_minor: paidMinor,
      balance_minor: balance,
      fully_paid: priced && balance === 0,
    };
  }
}

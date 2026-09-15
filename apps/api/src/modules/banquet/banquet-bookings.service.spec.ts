import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BanquetBookingStatus } from '@samco/database';
import { BanquetBookingsService, BANQUET_EVENT_TYPES } from './banquet-bookings.service.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import type { PrismaService } from '../../core/database/prisma.service.js';
import type { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { EventBroker } from '../../common/realtime/event-broker.js';
import type { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { ForbiddenException } from '@nestjs/common';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const BOOKING = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const HALL = '66666666-6666-4666-8666-666666666666';
const PACKAGE = '77777777-7777-4777-8777-777777777777';

const ctx = { companyId: COMPANY, branchId: BRANCH, actorUserId: USER };

// Far enough ahead that "the event has not started yet" stays true.
const STARTS = '2036-11-20T12:00:00.000Z';
const ENDS = '2036-11-20T18:00:00.000Z';

function makeBooking(over: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    company_id: COMPANY,
    branch_id: BRANCH,
    customer_id: CUSTOMER,
    customer: { id: CUSTOMER, name: 'Meera Iyer' },
    hall_id: HALL,
    hall: { id: HALL, name: 'Crystal', capacity: 200 },
    hall_name: 'Crystal',
    package_id: PACKAGE,
    starts_at: new Date(STARTS),
    ends_at: new Date(ENDS),
    guest_count: 80,
    extra_pax: 0,
    status: BanquetBookingStatus.DRAFT,
    package_name: 'Gold Veg',
    price_per_guest_minor: 125_000,
    currency: 'INR',
    gst_rate_bps: 0,
    total_amount_minor: 10_000_000,
    paid_minor: 0,
    notes: null,
    cancellation_reason: null,
    adjustments: [] as Array<Record<string, unknown>>,
    confirmed_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: new Date('2026-09-07T10:00:00.000Z'),
    updated_at: new Date('2026-09-07T10:00:00.000Z'),
    items: [
      { id: 'i1', name: 'Paneer Tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null },
    ],
    payments: [] as Array<{ amount_minor: number; [k: string]: unknown }>,
    event_plan: null,
    ...over,
  };
}

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  booking_id: BOOKING,
  amount_minor: 2_500_000,
  currency: 'INR',
  paid_at: new Date('2026-09-07T11:00:00.000Z'),
  method: 'cash',
  reference: null,
  kind: 'ADVANCE',
  actor_user_id: USER,
  verification: null,
  created_at: new Date('2026-09-07T11:00:00.000Z'),
  ...over,
});

const OTHER_USER = '88888888-8888-4888-8888-888888888888';

describe('BanquetBookingsService', () => {
  let tx: any;
  let prisma: any;
  let audit: { create: ReturnType<typeof vi.fn> };
  let broker: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscriberCount: ReturnType<typeof vi.fn> };
  let authorization: { hasBranchPermission: ReturnType<typeof vi.fn> };
  let service: BanquetBookingsService;

  beforeEach(() => {
    tx = {
      customer: { findFirst: vi.fn().mockResolvedValue({ id: CUSTOMER, status: 'ACTIVE' }) },
      branch: { findUnique: vi.fn().mockResolvedValue({ banquet_gst_rate_bps: 0 }) },
      banquetHall: {
        findFirst: vi.fn().mockResolvedValue({ id: HALL, name: 'Crystal', status: 'ACTIVE', capacity: 200 }),
      },
      banquetBookingAdjustment: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'adj-new',
          reverses_id: null,
          created_at: new Date(),
          ...data,
        })),
      },
      banquetPaymentVerification: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'ver-1',
          verified_at: new Date(),
          note: null,
          ...data,
        })),
      },
      banquetPackage: {
        findFirst: vi.fn().mockResolvedValue({
          id: PACKAGE,
          name: 'Gold Veg',
          price_per_guest_minor: 125_000,
          currency: 'INR',
          status: 'ACTIVE',
          items: [{ name: 'Paneer Tikka', position: 0 }],
        }),
      },
      banquetBooking: {
        create: vi.fn().mockResolvedValue(makeBooking()),
        findFirst: vi.fn().mockResolvedValue(makeBooking()),
        findUniqueOrThrow: vi.fn().mockResolvedValue(makeBooking()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(makeBooking()),
      },
      banquetPayment: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(payment({ actor_user_id: OTHER_USER })),
        create: vi.fn().mockResolvedValue(payment()),
      },
      // The payment path takes a row lock before reading the history.
      $queryRaw: vi.fn().mockResolvedValue([{ id: BOOKING }]),
      banquetEventPlan: {
        upsert: vi.fn().mockResolvedValue({
          id: 'ep1',
          booking_id: BOOKING,
          service_at: new Date('2026-11-20T13:00:00.000Z'),
          setup_notes: null,
          kitchen_notes: 'No nuts',
          created_at: new Date(),
          updated_at: new Date(),
        }),
      },
    };
    prisma = {
      $transaction: vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      banquetBooking: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    };
    audit = { create: vi.fn().mockResolvedValue(undefined) };
    broker = { publish: vi.fn(), subscribe: vi.fn(), subscriberCount: vi.fn() };
    authorization = { hasBranchPermission: vi.fn().mockResolvedValue(true) };
    service = new BanquetBookingsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      broker as unknown as EventBroker,
      authorization as unknown as AuthorizationService,
    );
  });

  const createDto = {
    customer_id: CUSTOMER,
    hall_id: HALL,
    package_id: PACKAGE,
    starts_at: STARTS,
    ends_at: ENDS,
    guest_count: 80,
  };

  // ── creation & snapshots ────────────────────────────────────────────────

  describe('create', () => {
    it('snapshots the hall name and the branch GST rate; no-GST mode on request', async () => {
      tx.branch.findUnique.mockResolvedValue({ banquet_gst_rate_bps: 500 });
      await service.create(ctx, { ...createDto, extra_pax: 10 });
      let data = tx.banquetBooking.create.mock.calls[0][0].data;
      expect(data.hall_name).toBe('Crystal');
      expect(data.gst_rate_bps).toBe(500);
      expect(data.extra_pax).toBe(10);
      // (80 + 10) × 125,000 = 11,250,000 taxable; + 5% = 562,500
      expect(data.total_amount_minor).toBe(11_812_500);

      tx.banquetBooking.create.mockClear();
      await service.create(ctx, { ...createDto, apply_gst: false });
      data = tx.banquetBooking.create.mock.calls[0][0].data;
      expect(data.gst_rate_bps).toBe(0);
      expect(data.total_amount_minor).toBe(10_000_000);
    });

    it('checks hall capacity against guaranteed guests plus extra pax', async () => {
      tx.banquetHall.findFirst.mockResolvedValue({ id: HALL, name: 'Crystal', status: 'ACTIVE', capacity: 85 });
      await expect(service.create(ctx, { ...createDto, extra_pax: 10 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('starts as a DRAFT and snapshots the package commercials', async () => {
      await service.create(ctx, createDto);
      const data = tx.banquetBooking.create.mock.calls[0][0].data;
      expect(data.status).toBe(BanquetBookingStatus.DRAFT);
      expect(data.package_name).toBe('Gold Veg');
      expect(data.price_per_guest_minor).toBe(125_000);
      expect(data.currency).toBe('INR');
      // price per guest × guests, computed once
      expect(data.total_amount_minor).toBe(10_000_000);
    });

    it('snapshots the package components so editing the package cannot rewrite history', async () => {
      await service.create(ctx, createDto);
      expect(tx.banquetBooking.create.mock.calls[0][0].data.items.create).toEqual([
        { name: 'Paneer Tikka', position: 0 },
      ]);
    });

    it('publishes nothing — a draft is invisible to the kitchen', async () => {
      await service.create(ctx, createDto);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('scopes the customer to the company in ONE query', async () => {
      await service.create(ctx, createDto);
      expect(tx.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CUSTOMER, company_id: COMPANY } }),
      );
    });

    it('rejects a customer from another company as not found', async () => {
      tx.customer.findFirst.mockResolvedValue(null);
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.banquetBooking.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive customer', async () => {
      tx.customer.findFirst.mockResolvedValue({ id: CUSTOMER, status: 'INACTIVE' });
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('scopes the hall to the branch and the package to the company', async () => {
      await service.create(ctx, createDto);
      expect(tx.banquetHall.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: HALL, branch_id: BRANCH } }),
      );
      expect(tx.banquetPackage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: PACKAGE, company_id: COMPANY } }),
      );
    });

    it('rejects a hall from another branch, an inactive hall, and one that is too small', async () => {
      tx.banquetHall.findFirst.mockResolvedValue(null);
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(NotFoundException);

      tx.banquetHall.findFirst.mockResolvedValue({ id: HALL, status: 'INACTIVE', capacity: 200 });
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(ConflictException);

      tx.banquetHall.findFirst.mockResolvedValue({ id: HALL, status: 'ACTIVE', capacity: 50 });
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a package from another company and an inactive package', async () => {
      tx.banquetPackage.findFirst.mockResolvedValue(null);
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(NotFoundException);

      tx.banquetPackage.findFirst.mockResolvedValue({
        id: PACKAGE, name: 'x', price_per_guest_minor: 1, currency: 'INR', status: 'INACTIVE', items: [],
      });
      await expect(service.create(ctx, createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      ['end before start', ENDS, STARTS],
      ['zero-length', STARTS, STARTS],
    ])('rejects %s', async (_label, starts, ends) => {
      await expect(
        service.create(ctx, { ...createDto, starts_at: starts, ends_at: ends }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.banquetBooking.create).not.toHaveBeenCalled();
    });

    it('rejects an unparseable instant', async () => {
      await expect(
        service.create(ctx, { ...createDto, starts_at: 'not-a-date' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps a hall overlap from the database into a controlled 409', async () => {
      prisma.$transaction.mockRejectedValue(
        new Error('conflicting key value violates exclusion constraint "banquet_bookings_hall_no_overlap"'),
      );
      const err = await service.create(ctx, createDto).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/already booked/i);
    });
  });

  // ── lifecycle ────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('confirm moves DRAFT -> CONFIRMED and stamps confirmed_at', async () => {
      tx.banquetBooking.findUniqueOrThrow.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.CONFIRMED }),
      );
      await service.confirm(ctx, BOOKING);
      const [{ where, data }] = tx.banquetBooking.updateMany.mock.calls[0];
      expect(data.status).toBe(BanquetBookingStatus.CONFIRMED);
      expect(data.confirmed_at).toBeInstanceOf(Date);
      // conditional on the status we validated — the concurrency guard
      expect(where).toEqual({ id: BOOKING, status: BanquetBookingStatus.DRAFT });
    });

    it('rejects an invalid transition with 409 and writes nothing', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.COMPLETED }),
      );
      await expect(service.confirm(ctx, BOOKING)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.banquetBooking.updateMany).not.toHaveBeenCalled();
      expect(audit.create).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('turns a lost concurrent race into a 409 rather than double-applying', async () => {
      tx.banquetBooking.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.confirm(ctx, BOOKING)).rejects.toBeInstanceOf(ConflictException);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('404s a booking outside the caller branch/company without disclosing it', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(null);
      await expect(service.confirm(ctx, BOOKING)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.banquetBooking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BOOKING, branch_id: BRANCH, company_id: COMPANY },
        }),
      );
    });

    it.each([BanquetBookingStatus.COMPLETED, BanquetBookingStatus.CANCELLED])(
      'refuses to edit a %s booking',
      async (status) => {
        tx.banquetBooking.findFirst.mockResolvedValue(makeBooking({ status }));
        await expect(service.update(ctx, BOOKING, { guest_count: 90 })).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(tx.banquetBooking.updateMany).not.toHaveBeenCalled();
      },
    );

    it('edits a CONFIRMED booking conditionally on its status and tells the kitchen', async () => {
      const confirmed = makeBooking({ status: BanquetBookingStatus.CONFIRMED });
      tx.banquetBooking.findFirst.mockResolvedValue(confirmed);
      tx.banquetBooking.findUniqueOrThrow.mockResolvedValue({ ...confirmed, guest_count: 90 });
      await service.update(ctx, BOOKING, { guest_count: 90 });
      const [{ where }] = tx.banquetBooking.updateMany.mock.calls[0];
      expect(where).toEqual({ id: BOOKING, status: BanquetBookingStatus.CONFIRMED });
      expect(broker.publish.mock.calls[0][1]).toBe(BANQUET_EVENT_TYPES.BOOKING_UPDATED);
    });

    it('audits old and new values of what changed, never the note text', async () => {
      await service.update(ctx, BOOKING, { guest_count: 100, notes: 'Bride wants the window table' });
      const payload = audit.create.mock.calls[0][0].payload;
      expect(payload.changes).toEqual({
        guest_count: { from: 80, to: 100 },
        total_amount_minor: { from: 10_000_000, to: 12_500_000 },
      });
      expect(payload.notes_changed).toBe(true);
      expect(JSON.stringify(payload)).not.toContain('window table');
    });

    it('takes the row lock before reading the booking', async () => {
      const order: string[] = [];
      tx.$queryRaw.mockImplementation(async () => {
        order.push('lock');
        return [{ id: BOOKING }];
      });
      tx.banquetBooking.findFirst.mockImplementation(async () => {
        order.push('read');
        return makeBooking();
      });
      await service.update(ctx, BOOKING, { guest_count: 81 });
      expect(order.slice(0, 2)).toEqual(['lock', 'read']);
    });

    it('refuses a change that would push the total below what is already paid', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ payments: [payment({ amount_minor: 9_000_000 })] }),
      );
      const err = await service.update(ctx, BOOKING, { guest_count: 40 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/already paid/);
      expect(tx.banquetBooking.updateMany).not.toHaveBeenCalled();
    });

    it('re-applies the branch GST rate only when asked, and never takes a rate from the client', async () => {
      tx.branch.findUnique.mockResolvedValue({ banquet_gst_rate_bps: 500 });
      await service.update(ctx, BOOKING, { apply_gst: true });
      const data = tx.banquetBooking.updateMany.mock.calls[0][0].data;
      expect(data.gst_rate_bps).toBe(500);
      expect(data.total_amount_minor).toBe(10_500_000);

      tx.banquetBooking.updateMany.mockClear();
      await service.update(ctx, BOOKING, { apply_gst: false });
      expect(tx.banquetBooking.updateMany.mock.calls[0][0].data.gst_rate_bps).toBe(0);
    });
  });

  // ── past-date control ───────────────────────────────────────────────────

  describe('past events', () => {
    const past = () =>
      makeBooking({
        status: BanquetBookingStatus.CONFIRMED,
        starts_at: new Date('2020-01-01T10:00:00.000Z'),
        ends_at: new Date('2020-01-01T16:00:00.000Z'),
      });

    it('does not consult the edit_past permission for a future event', async () => {
      await service.update(ctx, BOOKING, { guest_count: 81 });
      expect(authorization.hasBranchPermission).not.toHaveBeenCalled();
    });

    it('refuses to change a started event without banquet.booking.edit_past', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(past());
      authorization.hasBranchPermission.mockResolvedValue(false);
      await expect(service.update(ctx, BOOKING, { guest_count: 81 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(authorization.hasBranchPermission).toHaveBeenCalledWith(
        USER,
        COMPANY,
        BRANCH,
        'banquet.booking.edit_past',
      );
      expect(tx.banquetBooking.updateMany).not.toHaveBeenCalled();
      expect(audit.create).not.toHaveBeenCalled();
    });

    it('allows it with the permission and marks the audit record', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(past());
      await service.update(ctx, BOOKING, { guest_count: 81 });
      expect(audit.create.mock.calls[0][0].payload.past_event).toBe(true);
    });

    it('applies to pricing lines too', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(past());
      authorization.hasBranchPermission.mockImplementation(
        async (_u: string, _c: string, _b: string, key: string) => key !== 'banquet.booking.edit_past',
      );
      await expect(
        service.addAdjustment(ctx, BOOKING, { kind: 'EXTRA_CHARGE', description: 'DJ', amount_minor: 100 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.banquetBookingAdjustment.create).not.toHaveBeenCalled();
    });
  });

  // ── pricing adjustments ─────────────────────────────────────────────────

  describe('adjustments', () => {
    it('appends the line, re-prices from the snapshot and audits the total change', async () => {
      await service.addAdjustment(ctx, BOOKING, {
        kind: 'EXTRA_CHARGE',
        description: 'Decoration',
        amount_minor: 500_000,
      });
      expect(tx.banquetBookingAdjustment.create.mock.calls[0][0].data).toMatchObject({
        booking_id: BOOKING,
        company_id: COMPANY,
        branch_id: BRANCH,
        kind: 'EXTRA_CHARGE',
        amount_minor: 500_000,
        actor_user_id: USER,
      });
      expect(tx.banquetBooking.update.mock.calls[0][0].data).toEqual({ total_amount_minor: 10_500_000 });
      expect(audit.create.mock.calls[0][0].payload.changes).toEqual({
        total_amount_minor: { from: 10_000_000, to: 10_500_000 },
      });
    });

    it.each([
      ['EXTRA_CHARGE', 'banquet.charge.manage'],
      ['LINE_DISCOUNT', 'banquet.discount.apply'],
      ['PER_HEAD_DISCOUNT', 'banquet.discount.apply'],
      ['ADMIN_DISCOUNT', 'banquet.discount.admin'],
    ] as const)('a %s needs %s specifically', async (kind, key) => {
      authorization.hasBranchPermission.mockResolvedValue(false);
      await expect(
        service.addAdjustment(ctx, BOOKING, { kind, description: 'x', amount_minor: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(authorization.hasBranchPermission).toHaveBeenCalledWith(USER, COMPANY, BRANCH, key);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses discounts larger than the booking value', async () => {
      await expect(
        service.addAdjustment(ctx, BOOKING, { kind: 'ADMIN_DISCOUNT', description: 'x', amount_minor: 10_000_001 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to re-price a completed or cancelled booking', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(makeBooking({ status: BanquetBookingStatus.COMPLETED }));
      await expect(
        service.addAdjustment(ctx, BOOKING, { kind: 'EXTRA_CHARGE', description: 'x', amount_minor: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.banquetBookingAdjustment.create).not.toHaveBeenCalled();
    });

    it('withdraws a line by appending a reversal, once', async () => {
      const line = { id: 'adj-1', kind: 'ADMIN_DISCOUNT', description: 'Loyalty', amount_minor: 1_000_000, reverses_id: null, actor_user_id: USER, created_at: new Date() };
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ adjustments: [line], total_amount_minor: 9_000_000 }),
      );
      await service.reverseAdjustment(ctx, BOOKING, 'adj-1');
      expect(tx.banquetBookingAdjustment.create.mock.calls[0][0].data).toMatchObject({
        kind: 'ADMIN_DISCOUNT',
        amount_minor: 1_000_000,
        reverses_id: 'adj-1',
      });
      expect(tx.banquetBooking.update.mock.calls[0][0].data).toEqual({ total_amount_minor: 10_000_000 });

      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({
          adjustments: [line, { ...line, id: 'adj-2', reverses_id: 'adj-1' }],
        }),
      );
      await expect(service.reverseAdjustment(ctx, BOOKING, 'adj-1')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.reverseAdjustment(ctx, BOOKING, 'adj-2')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.reverseAdjustment(ctx, BOOKING, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('exposes the invoice and which lines are in force on the detail view', async () => {
      const line = { id: 'adj-1', kind: 'EXTRA_CHARGE', description: 'DJ', amount_minor: 200_000, reverses_id: null, actor_user_id: USER, created_at: new Date() };
      prisma.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ adjustments: [line], total_amount_minor: 10_200_000, gst_rate_bps: 0 }),
      );
      const detail = await service.get(BRANCH, BOOKING);
      expect(detail.invoice.extra_charges_minor).toBe(200_000);
      expect(detail.invoice.total_minor).toBe(10_200_000);
      expect(detail.adjustments[0]).toMatchObject({ id: 'adj-1', active: true, reversed_by_id: null });
    });

    it('re-prices from the SNAPSHOT when the guest count changes, not from the live package', async () => {
      await service.update(ctx, BOOKING, { guest_count: 100 });
      const data = tx.banquetBooking.updateMany.mock.calls[0][0].data;
      expect(data.guest_count).toBe(100);
      expect(data.total_amount_minor).toBe(12_500_000); // 125_000 × 100
      expect(tx.banquetPackage.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── payments ─────────────────────────────────────────────────────────────

  describe('payments', () => {
    const dto = { amount_minor: 2_500_000, currency: 'INR' };

    it('records an advance and returns the derived balance', async () => {
      const result = await service.createPayment(ctx, BOOKING, dto);
      expect(result.balance).toEqual({
        currency: 'INR',
        total_amount_minor: 10_000_000,
        paid_minor: 2_500_000,
        balance_minor: 7_500_000,
        fully_paid: false,
      });
    });

    it('locks the booking row BEFORE reading the history, so a stale balance cannot be used', async () => {
      const order: string[] = [];
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        order.push(strings.join('?').includes('FOR UPDATE') ? 'lock' : 'other-sql');
        return [{ id: BOOKING }];
      });
      tx.banquetPayment.findMany.mockImplementation(async () => {
        order.push('read-history');
        return [];
      });
      tx.banquetPayment.create.mockImplementation(async () => {
        order.push('insert');
        return payment();
      });

      await service.createPayment(ctx, BOOKING, dto);

      expect(order).toEqual(['lock', 'read-history', 'insert']);
      expect(tx.banquetPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { booking_id: BOOKING } }),
      );
    });

    it('marks the booking fully paid when the balance reaches zero', async () => {
      tx.banquetPayment.findMany.mockResolvedValue([{ amount_minor: 7_500_000 }]);
      const result = await service.createPayment(ctx, BOOKING, dto);
      expect(result.balance.balance_minor).toBe(0);
      expect(result.balance.fully_paid).toBe(true);
    });

    it('rejects overpayment rather than allowing a negative balance', async () => {
      tx.banquetPayment.findMany.mockResolvedValue([{ amount_minor: 9_000_000 }]);
      const err = await service
        .createPayment(ctx, BOOKING, { amount_minor: 2_000_000, currency: 'INR' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/exceeds the outstanding balance of 1000000/);
      expect(tx.banquetPayment.create).not.toHaveBeenCalled();
    });

    it('rejects a currency that does not match the booking snapshot', async () => {
      const err = await service
        .createPayment(ctx, BOOKING, { amount_minor: 100, currency: 'USD' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/USD.*INR/);
      expect(tx.banquetPayment.create).not.toHaveBeenCalled();
    });

    it('rejects a malformed currency before touching the database', async () => {
      await expect(
        service.createPayment(ctx, BOOKING, { amount_minor: 100, currency: 'inr' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to take money for a cancelled booking', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.CANCELLED }),
      );
      await expect(service.createPayment(ctx, BOOKING, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('keeps the payment reference out of the audit payload', async () => {
      await service.createPayment(ctx, BOOKING, { ...dto, reference: 'TXN-SECRET-9931' });
      const blob = JSON.stringify(audit.create.mock.calls.map((c: unknown[]) => c[0]));
      expect(blob).not.toContain('TXN-SECRET-9931');
      expect(blob).toContain('has_reference');
    });

    it('exposes no way to amend or remove a recorded payment', () => {
      // Append-only is enforced by database triggers; this asserts the service
      // offers no route to them either — create, read, and a separate
      // verification record.
      const api = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const paymentApi = api.filter((m) => /payment/i.test(m) && !m.startsWith('to'));
      expect(paymentApi.sort()).toEqual(['createPayment', 'listPayments', 'verifyPayment']);
      expect(api.some((m) => /^(update|delete|void|refund|amend).*payment/i.test(m))).toBe(false);
    });

    it('decides the settlement stage itself and refreshes the stored paid amount', async () => {
      await service.createPayment(ctx, BOOKING, dto);
      expect(tx.banquetPayment.create.mock.calls[0][0].data.kind).toBe('ADVANCE');
      expect(tx.banquetBooking.update.mock.calls[0][0].data).toEqual({ paid_minor: 2_500_000 });

      tx.banquetPayment.create.mockClear();
      tx.banquetPayment.findMany.mockResolvedValue([{ amount_minor: 7_500_000 }]);
      await service.createPayment(ctx, BOOKING, dto);
      expect(tx.banquetPayment.create.mock.calls[0][0].data.kind).toBe('FINAL');
    });
  });

  describe('payment verification', () => {
    it('records a separate verification by a second person', async () => {
      const view = await service.verifyPayment(ctx, 'p1', { note: 'Seen in bank' });
      expect(tx.banquetPayment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', branch_id: BRANCH, company_id: COMPANY } }),
      );
      expect(tx.banquetPaymentVerification.create.mock.calls[0][0].data).toMatchObject({
        payment_id: 'p1',
        verified_by_user_id: USER,
      });
      expect(view.verification?.verified_by_user_id).toBe(USER);
      expect(audit.create.mock.calls[0][0].entityType).toBe('BANQUET_PAYMENT_VERIFICATION');
    });

    it('never lets the recorder verify their own payment', async () => {
      tx.banquetPayment.findFirst.mockResolvedValue(payment({ actor_user_id: USER }));
      await expect(service.verifyPayment(ctx, 'p1', {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.banquetPaymentVerification.create).not.toHaveBeenCalled();
    });

    it('verifies once, and 404s a payment of another branch', async () => {
      tx.banquetPayment.findFirst.mockResolvedValue(
        payment({ actor_user_id: OTHER_USER, verification: { verified_by_user_id: USER, verified_at: new Date(), note: null } }),
      );
      await expect(service.verifyPayment(ctx, 'p1', {})).rejects.toBeInstanceOf(ConflictException);

      tx.banquetPayment.findFirst.mockResolvedValue(null);
      await expect(service.verifyPayment(ctx, 'p1', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── audit & realtime ─────────────────────────────────────────────────────

  describe('audit', () => {
    it('writes the audit record inside the same transaction as the mutation', async () => {
      await service.create(ctx, createDto);
      const [params, passedTx] = audit.create.mock.calls[0];
      expect(passedTx).toBe(tx);
      expect(params).toMatchObject({
        actorUserId: USER,
        companyId: COMPANY,
        branchId: BRANCH,
        entityType: 'BANQUET_BOOKING',
      });
    });

    it('keeps customer PII out of audit payloads', async () => {
      await service.create(ctx, createDto);
      const blob = JSON.stringify(audit.create.mock.calls.map((c: unknown[]) => c[0]));
      expect(blob).not.toContain('Meera Iyer');
    });
  });

  describe('realtime', () => {
    it('publishes on the branch banquet-kds channel AFTER the transaction returns', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const out = await fn(tx);
        order.push('commit');
        return out;
      });
      broker.publish.mockImplementation(() => order.push('publish'));

      await service.confirm(ctx, BOOKING);

      expect(order).toEqual(['commit', 'publish']);
      const [scope, type] = broker.publish.mock.calls[0];
      expect(scope).toEqual({
        companyId: COMPANY,
        branchId: BRANCH,
        channel: RealtimeChannel.BANQUET_KDS,
      });
      expect(type).toBe(BANQUET_EVENT_TYPES.BOOKING_CONFIRMED);
    });

    it('publishes nothing when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('rolled back'));
      await expect(service.confirm(ctx, BOOKING)).rejects.toThrow('rolled back');
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it.each([
      ['confirm', BANQUET_EVENT_TYPES.BOOKING_CONFIRMED],
      ['cancel', BANQUET_EVENT_TYPES.BOOKING_CANCELLED],
    ])('%s publishes %s', async (method, expected) => {
      await (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](
        ctx,
        BOOKING,
      );
      expect(broker.publish.mock.calls[0][1]).toBe(expected);
    });

    it('cancel keeps the reason on the booking but only its presence in the audit', async () => {
      await service.cancel(ctx, BOOKING, 'Family emergency');
      expect(tx.banquetBooking.updateMany.mock.calls[0][0].data.cancellation_reason).toBe('Family emergency');
      const payload = audit.create.mock.calls[0][0].payload;
      expect(payload.has_reason).toBe(true);
      expect(JSON.stringify(payload)).not.toContain('Family emergency');
    });

    it('complete publishes its own event from CONFIRMED', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.CONFIRMED }),
      );
      await service.complete(ctx, BOOKING);
      expect(broker.publish.mock.calls[0][1]).toBe(BANQUET_EVENT_TYPES.BOOKING_COMPLETED);
    });

    it('carries a kitchen-safe payload: no customer, no money, no notes', async () => {
      tx.banquetBooking.findUniqueOrThrow.mockResolvedValue(
        makeBooking({
          status: BanquetBookingStatus.CONFIRMED,
          notes: 'Bride prefers table by the window',
          event_plan: {
            id: 'ep1',
            booking_id: BOOKING,
            service_at: new Date('2026-11-20T13:00:00.000Z'),
            setup_notes: 'Round tables',
            kitchen_notes: 'No nuts',
            created_at: new Date(),
            updated_at: new Date(),
          },
        }),
      );
      await service.confirm(ctx, BOOKING);

      const payload = broker.publish.mock.calls[0][2] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(
        [
          'branch_id',
          'ends_at',
          'guest_count',
          'hall_name',
          'id',
          'items',
          'kitchen_notes',
          'service_at',
          'starts_at',
          'status',
        ].sort(),
      );
      const json = JSON.stringify(payload);
      expect(json).not.toContain('Meera Iyer');
      expect(json).not.toContain('Bride prefers');
      expect(json).not.toMatch(/total_amount|price_per_guest|currency|customer/i);
      // The kitchen DOES get what it needs to cook.
      expect(payload.kitchen_notes).toBe('No nuts');
      expect(payload.hall_name).toBe('Crystal');
    });
  });

  // ── event plan ───────────────────────────────────────────────────────────

  describe('event plan', () => {
    it('upserts one plan per booking and publishes to the kitchen', async () => {
      const plan = await service.upsertEventPlan(ctx, BOOKING, { kitchen_notes: 'No nuts' });
      expect(tx.banquetEventPlan.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { booking_id: BOOKING } }),
      );
      expect(plan.kitchen_notes).toBe('No nuts');
      expect(broker.publish.mock.calls[0][1]).toBe(BANQUET_EVENT_TYPES.EVENT_PLAN_UPDATED);
    });

    it('refuses a plan for a cancelled booking', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.CANCELLED }),
      );
      await expect(service.upsertEventPlan(ctx, BOOKING, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(broker.publish).not.toHaveBeenCalled();
    });
  });

  // ── reads ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('always pins the branch and applies the filters', async () => {
      await service.list(BRANCH, {
        limit: 10,
        offset: 5,
        status: BanquetBookingStatus.CONFIRMED,
        hall_id: HALL,
        from: STARTS,
        to: ENDS,
      });
      const args = prisma.banquetBooking.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        branch_id: BRANCH,
        status: BanquetBookingStatus.CONFIRMED,
        hall_id: HALL,
      });
      expect(args.where.starts_at).toEqual({ gte: new Date(STARTS), lte: new Date(ENDS) });
      expect(args.take).toBe(10);
      expect(args.skip).toBe(5);
    });
  });

  describe('detail view', () => {
    it('derives the balance from the payment history rather than a stored column', async () => {
      prisma.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ payments: [payment({ amount_minor: 3_000_000 }), payment({ id: 'p2', amount_minor: 1_000_000 })] }),
      );
      const detail = await service.get(BRANCH, BOOKING);
      expect(detail.balance).toEqual({
        currency: 'INR',
        total_amount_minor: 10_000_000,
        paid_minor: 4_000_000,
        balance_minor: 6_000_000,
        fully_paid: false,
      });
      expect(detail).not.toHaveProperty('balance_minor');
    });
  });
});

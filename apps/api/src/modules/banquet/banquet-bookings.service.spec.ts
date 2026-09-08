import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BanquetBookingStatus } from '@samco/database';
import { BanquetBookingsService, BANQUET_EVENT_TYPES } from './banquet-bookings.service.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import type { PrismaService } from '../../core/database/prisma.service.js';
import type { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { EventBroker } from '../../common/realtime/event-broker.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const BOOKING = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const HALL = '66666666-6666-4666-8666-666666666666';
const PACKAGE = '77777777-7777-4777-8777-777777777777';

const ctx = { companyId: COMPANY, branchId: BRANCH, actorUserId: USER };

const STARTS = '2026-11-20T12:00:00.000Z';
const ENDS = '2026-11-20T18:00:00.000Z';

function makeBooking(over: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    company_id: COMPANY,
    branch_id: BRANCH,
    customer_id: CUSTOMER,
    customer: { id: CUSTOMER, name: 'Meera Iyer' },
    hall_id: HALL,
    hall: { id: HALL, name: 'Crystal', capacity: 200 },
    package_id: PACKAGE,
    starts_at: new Date(STARTS),
    ends_at: new Date(ENDS),
    guest_count: 80,
    status: BanquetBookingStatus.DRAFT,
    package_name: 'Gold Veg',
    price_per_guest_minor: 125_000,
    currency: 'INR',
    total_amount_minor: 10_000_000,
    notes: null,
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
  actor_user_id: USER,
  created_at: new Date('2026-09-07T11:00:00.000Z'),
  ...over,
});

describe('BanquetBookingsService', () => {
  let tx: any;
  let prisma: any;
  let audit: { create: ReturnType<typeof vi.fn> };
  let broker: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscriberCount: ReturnType<typeof vi.fn> };
  let service: BanquetBookingsService;

  beforeEach(() => {
    tx = {
      customer: { findFirst: vi.fn().mockResolvedValue({ id: CUSTOMER, status: 'ACTIVE' }) },
      banquetHall: { findFirst: vi.fn().mockResolvedValue({ id: HALL, status: 'ACTIVE', capacity: 200 }) },
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
      banquetPayment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(payment()) },
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
    service = new BanquetBookingsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      broker as unknown as EventBroker,
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

    it('refuses to edit anything but a draft', async () => {
      tx.banquetBooking.findFirst.mockResolvedValue(
        makeBooking({ status: BanquetBookingStatus.CONFIRMED }),
      );
      await expect(service.update(ctx, BOOKING, { guest_count: 90 })).rejects.toBeInstanceOf(
        ConflictException,
      );
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
      // offers no route to them either — only create and read.
      const api = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const paymentApi = api.filter((m) => /payment/i.test(m) && !m.startsWith('to'));
      expect(paymentApi.sort()).toEqual(['createPayment', 'listPayments']);
      expect(api.some((m) => /^(update|delete|void|refund|amend).*payment/i.test(m))).toBe(false);
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

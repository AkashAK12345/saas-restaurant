import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueueTokenStatus, QueueTokenEventType } from '@samco/database';
import { QueueTokensService, QUEUE_EVENT_TYPES } from './queue-tokens.service.js';
import { RealtimeChannel } from '../../common/realtime/channels.js';
import type { PrismaService } from '../../core/database/prisma.service.js';
import type { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { EventBroker } from '../../common/realtime/event-broker.js';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const TOKEN = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';
const TABLE = '66666666-6666-4666-8666-666666666666';

const ctx = { companyId: COMPANY, branchId: BRANCH, actorUserId: USER };

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN,
    company_id: COMPANY,
    branch_id: BRANCH,
    customer_id: null,
    customer: null,
    service_date: new Date('2026-09-07T00:00:00.000Z'),
    token_number: 1,
    status: QueueTokenStatus.WAITING,
    adults: 2,
    kids: 0,
    party_size: 2,
    advance_booking_at: null,
    assigned_table_id: null,
    assigned_table: null,
    called_at: null,
    seated_at: null,
    cancelled_at: null,
    no_show_at: null,
    created_at: new Date('2026-09-07T10:00:00.000Z'),
    updated_at: new Date('2026-09-07T10:00:00.000Z'),
    ...overrides,
  };
}

describe('QueueTokensService', () => {
  let tx: any;
  let prisma: any;
  let audit: { create: ReturnType<typeof vi.fn> };
  let broker: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; subscriberCount: ReturnType<typeof vi.fn> };
  let service: QueueTokensService;

  beforeEach(() => {
    tx = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({
          company_id: COMPANY,
          status: 'ACTIVE',
          timezone: 'Asia/Kolkata',
        }),
      },
      customer: { findFirst: vi.fn() },
      table: { findFirst: vi.fn() },
      queueToken: {
        create: vi.fn().mockResolvedValue(makeToken()),
        // findFirst serves two different queries: loading the token being
        // mutated, and probing whether a table is already occupied. The probe
        // is the one keyed on assigned_table_id — unoccupied by default.
        findFirst: vi.fn((args: { where: Record<string, unknown> }) =>
          Promise.resolve('assigned_table_id' in args.where ? null : makeToken()),
        ),
        findUniqueOrThrow: vi.fn().mockResolvedValue(makeToken()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      queueTokenEvent: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ allocated: 7 }]),
    };
    prisma = {
      $transaction: vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      branch: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
      queueToken: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    };
    audit = { create: vi.fn().mockResolvedValue(undefined) };
    broker = { publish: vi.fn(), subscribe: vi.fn(), subscriberCount: vi.fn() };
    service = new QueueTokensService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditLogService,
      broker as unknown as EventBroker,
    );
  });

  // ───────────────────────────── registration ─────────────────────────────

  describe('register', () => {
    it('allocates the number in one locking statement inside the transaction', async () => {
      await service.register(ctx, { adults: 2 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = tx.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('INSERT INTO "queue_counters"');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE');
      expect(tx.queueToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ token_number: 7 }) }),
      );
    });

    it('derives the service date from the BRANCH timezone', async () => {
      // 19:00 UTC on the 7th is already the 8th in Kolkata.
      vi.setSystemTime(new Date('2026-09-07T19:00:00.000Z'));
      await service.register(ctx, { adults: 2 });
      expect(tx.queueToken.create.mock.calls[0][0].data.service_date.toISOString()).toBe(
        '2026-09-08T00:00:00.000Z',
      );
      vi.useRealTimers();
    });

    it('starts the token WAITING and writes a REGISTERED history row', async () => {
      await service.register(ctx, { adults: 4 });
      expect(tx.queueToken.create.mock.calls[0][0].data.status).toBe(QueueTokenStatus.WAITING);
      expect(tx.queueTokenEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: QueueTokenEventType.REGISTERED,
          previous_status: null,
          new_status: QueueTokenStatus.WAITING,
          actor_user_id: USER,
        }),
      });
    });

    it('registers an anonymous walk-in without touching customers', async () => {
      const view = await service.register(ctx, { adults: 2 });
      expect(tx.customer.findFirst).not.toHaveBeenCalled();
      expect(tx.queueToken.create.mock.calls[0][0].data.customer_id).toBeNull();
      expect(view.customer_id).toBeNull();
    });

    it('accepts a customer of the same company', async () => {
      tx.customer.findFirst.mockResolvedValue({ id: CUSTOMER, status: 'ACTIVE' });
      await service.register(ctx, { adults: 2, customer_id: CUSTOMER });
      // Scoped by id AND company in ONE query — never fetch-then-compare.
      expect(tx.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CUSTOMER, company_id: COMPANY } }),
      );
      expect(tx.queueToken.create.mock.calls[0][0].data.customer_id).toBe(CUSTOMER);
    });

    it('rejects a customer from another company as not found', async () => {
      tx.customer.findFirst.mockResolvedValue(null); // scoped query finds nothing
      await expect(service.register(ctx, { adults: 2, customer_id: CUSTOMER })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.queueToken.create).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('rejects an inactive customer', async () => {
      tx.customer.findFirst.mockResolvedValue({ id: CUSTOMER, status: 'INACTIVE' });
      await expect(service.register(ctx, { adults: 2, customer_id: CUSTOMER })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('never creates a customer record implicitly', async () => {
      await service.register(ctx, { adults: 2 });
      expect(tx.customer.create).toBeUndefined();
    });

    it('rejects registration at a branch that is no longer active', async () => {
      tx.branch.findUnique.mockResolvedValue({ company_id: COMPANY, status: 'INACTIVE', timezone: 'UTC' });
      await expect(service.register(ctx, { adults: 2 })).rejects.toBeInstanceOf(ConflictException);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('rejects a branch that belongs to another company', async () => {
      tx.branch.findUnique.mockResolvedValue({ company_id: 'other', status: 'ACTIVE', timezone: 'UTC' });
      await expect(service.register(ctx, { adults: 2 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fails loudly if the counter returns nothing usable', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(service.register(ctx, { adults: 2 })).rejects.toThrow();
      expect(broker.publish).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────── transitions ─────────────────────────────

  describe('lifecycle operations', () => {
    it('call moves WAITING -> CALLED and stamps called_at', async () => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: QueueTokenStatus.WAITING }));
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(makeToken({ status: QueueTokenStatus.CALLED }));

      await service.call(ctx, TOKEN);

      const [{ where, data }] = tx.queueToken.updateMany.mock.calls[0];
      expect(data.status).toBe(QueueTokenStatus.CALLED);
      expect(data.called_at).toBeInstanceOf(Date);
      // Conditional on the status we validated — the concurrency guard.
      expect(where).toEqual({ id: TOKEN, status: QueueTokenStatus.WAITING });
    });

    it('rejects an invalid transition with a 409 and writes nothing', async () => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: QueueTokenStatus.SEATED }));
      await expect(service.call(ctx, TOKEN)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.queueToken.updateMany).not.toHaveBeenCalled();
      expect(tx.queueTokenEvent.create).not.toHaveBeenCalled();
      expect(audit.create).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('turns a lost concurrent race into a 409 rather than double-applying', async () => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: QueueTokenStatus.WAITING }));
      tx.queueToken.updateMany.mockResolvedValue({ count: 0 }); // another operator won
      await expect(service.call(ctx, TOKEN)).rejects.toBeInstanceOf(ConflictException);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('404s a token outside the caller branch/company without disclosing it', async () => {
      tx.queueToken.findFirst.mockResolvedValue(null);
      await expect(service.call(ctx, TOKEN)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.queueToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TOKEN, branch_id: BRANCH, company_id: COMPANY },
        }),
      );
    });

    it('seat without a table moves CALLED -> SEATED', async () => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: QueueTokenStatus.CALLED }));
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(makeToken({ status: QueueTokenStatus.SEATED }));
      await service.seat(ctx, TOKEN, {});
      expect(tx.queueToken.updateMany.mock.calls[0][0].data).toMatchObject({
        status: QueueTokenStatus.SEATED,
        assigned_table_id: null,
      });
      expect(tx.table.findFirst).not.toHaveBeenCalled();
    });

    it('seat with a table assigns it and records both history rows', async () => {
      // Keep the two findFirst roles distinct: load the token, but report the
      // table as unoccupied.
      tx.queueToken.findFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'assigned_table_id' in args.where ? null : makeToken({ status: QueueTokenStatus.CALLED }),
        ),
      );
      tx.table.findFirst.mockResolvedValue({ id: TABLE, status: 'ACTIVE' });
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(
        makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: TABLE }),
      );

      await service.seat(ctx, TOKEN, { table_id: TABLE });

      expect(tx.queueToken.updateMany.mock.calls[0][0].data.assigned_table_id).toBe(TABLE);
      const types = tx.queueTokenEvent.create.mock.calls.map((c: any[]) => c[0].data.event_type);
      expect(types).toEqual([QueueTokenEventType.SEATED, QueueTokenEventType.TABLE_ASSIGNED]);
    });

    it('no-show moves CALLED -> NO_SHOW; cancel works from WAITING and CALLED', async () => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: QueueTokenStatus.CALLED }));
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(makeToken({ status: QueueTokenStatus.NO_SHOW }));
      await service.noShow(ctx, TOKEN);
      expect(tx.queueToken.updateMany.mock.calls[0][0].data.no_show_at).toBeInstanceOf(Date);

      for (const from of [QueueTokenStatus.WAITING, QueueTokenStatus.CALLED]) {
        tx.queueToken.updateMany.mockClear();
        tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: from }));
        tx.queueToken.findUniqueOrThrow.mockResolvedValue(makeToken({ status: QueueTokenStatus.CANCELLED }));
        await service.cancel(ctx, TOKEN);
        expect(tx.queueToken.updateMany.mock.calls[0][0].data.status).toBe(QueueTokenStatus.CANCELLED);
      }
    });
  });

  // ───────────────────────────── table assignment ─────────────────────────────

  describe('table assignment', () => {
    /** Load returns the given token; the occupancy probe returns `occupant`. */
    const withToken = (token: unknown, occupant: unknown = null) => {
      tx.queueToken.findFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
        Promise.resolve('assigned_table_id' in args.where ? occupant : token),
      );
    };

    beforeEach(() => {
      withToken(makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: null }));
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(
        makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: TABLE }),
      );
    });

    it('scopes the table to the token branch in one query', async () => {
      tx.table.findFirst.mockResolvedValue({ id: TABLE, status: 'ACTIVE' });
      await service.assignTable(ctx, TOKEN, TABLE);
      expect(tx.table.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TABLE, branch_id: BRANCH } }),
      );
    });

    it('rejects a table from another branch as not found', async () => {
      tx.table.findFirst.mockResolvedValue(null);
      await expect(service.assignTable(ctx, TOKEN, TABLE)).rejects.toBeInstanceOf(NotFoundException);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('rejects an inactive table', async () => {
      tx.table.findFirst.mockResolvedValue({ id: TABLE, status: 'INACTIVE' });
      await expect(service.assignTable(ctx, TOKEN, TABLE)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a table already held by another seated party', async () => {
      tx.table.findFirst.mockResolvedValue({ id: TABLE, status: 'ACTIVE' });
      withToken(makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: null }), {
        id: 'other-token',
      });
      await expect(service.assignTable(ctx, TOKEN, TABLE)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to assign a table to a party that is not seated', async () => {
      withToken(makeToken({ status: QueueTokenStatus.WAITING }));
      await expect(service.assignTable(ctx, TOKEN, TABLE)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a second table while one is held', async () => {
      withToken(makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: 'held' }));
      await expect(service.assignTable(ctx, TOKEN, TABLE)).rejects.toBeInstanceOf(ConflictException);
    });

    it('release frees the table and keeps the seating status', async () => {
      withToken(makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: TABLE }));
      tx.queueToken.findUniqueOrThrow.mockResolvedValue(
        makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: null }),
      );
      await service.releaseTable(ctx, TOKEN);
      expect(tx.queueToken.updateMany.mock.calls[0][0].data).toEqual({ assigned_table_id: null });
      const ev = tx.queueTokenEvent.create.mock.calls[0][0].data;
      expect(ev.event_type).toBe(QueueTokenEventType.TABLE_RELEASED);
      expect(ev.metadata).toEqual({ table_id: TABLE });
    });

    it('refuses to release when no table is held', async () => {
      withToken(makeToken({ status: QueueTokenStatus.SEATED, assigned_table_id: null }));
      await expect(service.releaseTable(ctx, TOKEN)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ───────────────────────────── audit + realtime ─────────────────────────────

  describe('audit', () => {
    it('writes the audit record inside the same transaction as the mutation', async () => {
      await service.register(ctx, { adults: 2 });
      const [params, passedTx] = audit.create.mock.calls[0];
      expect(passedTx).toBe(tx); // STRICT policy: rolls back with the mutation
      expect(params).toMatchObject({
        actorUserId: USER,
        companyId: COMPANY,
        branchId: BRANCH,
        entityType: 'QUEUE_TOKEN',
      });
    });

    it('keeps customer PII out of audit payloads', async () => {
      tx.customer.findFirst.mockResolvedValue({ id: CUSTOMER, status: 'ACTIVE' });
      tx.queueToken.create.mockResolvedValue(
        makeToken({ customer_id: CUSTOMER, customer: { id: CUSTOMER, name: 'Asha Rao' } }),
      );
      await service.register(ctx, { adults: 2, customer_id: CUSTOMER });
      const payload = JSON.stringify(audit.create.mock.calls[0][0].payload);
      expect(payload).not.toContain('Asha Rao');
      expect(payload).not.toContain('phone');
      expect(audit.create.mock.calls[0][0].payload).toMatchObject({ has_customer: true });
    });
  });

  describe('realtime', () => {
    it('publishes on the branch queue channel AFTER the transaction returns', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
        const out = await fn(tx);
        order.push('commit');
        return out;
      });
      broker.publish.mockImplementation(() => order.push('publish'));

      await service.register(ctx, { adults: 2 });

      expect(order).toEqual(['commit', 'publish']);
      const [scope, type] = broker.publish.mock.calls[0];
      expect(scope).toEqual({ companyId: COMPANY, branchId: BRANCH, channel: RealtimeChannel.QUEUE });
      expect(type).toBe(QUEUE_EVENT_TYPES.REGISTERED);
    });

    it('publishes nothing when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('rolled back'));
      await expect(service.register(ctx, { adults: 2 })).rejects.toThrow('rolled back');
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it.each([
      ['call', QueueTokenStatus.WAITING, QUEUE_EVENT_TYPES.CALLED],
      ['noShow', QueueTokenStatus.CALLED, QUEUE_EVENT_TYPES.NO_SHOW],
      ['cancel', QueueTokenStatus.WAITING, QUEUE_EVENT_TYPES.CANCELLED],
    ])('%s publishes %s', async (method, from, expected) => {
      tx.queueToken.findFirst.mockResolvedValue(makeToken({ status: from }));
      await (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](ctx, TOKEN);
      expect(broker.publish.mock.calls[0][1]).toBe(expected);
    });

    it('carries the display-safe projection — no customer name, no credentials', async () => {
      tx.queueToken.create.mockResolvedValue(
        makeToken({ customer_id: CUSTOMER, customer: { id: CUSTOMER, name: 'Asha Rao' } }),
      );
      tx.customer.findFirst.mockResolvedValue({ id: CUSTOMER, status: 'ACTIVE' });
      const returned = await service.register(ctx, { adults: 2, customer_id: CUSTOMER });

      const payload = broker.publish.mock.calls[0][2] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(
        [
          'assigned_table',
          'assigned_table_id',
          'branch_id',
          'called_at',
          'cancelled_at',
          'company_id',
          'created_at',
          'customer_id',
          'id',
          'no_show_at',
          'adults',
          'kids',
          'party_size',
          'advance_booking_at',
          'seated_at',
          'service_date',
          'status',
          'token_number',
          'updated_at',
        ].sort(),
      );
      // The `queue` channel is shared with dining-room screens: the name is
      // deliberately absent from the broadcast but present in the caller's
      // own permission-gated response.
      expect(payload).not.toHaveProperty('customer');
      expect(returned.customer).toEqual({ id: CUSTOMER, name: 'Asha Rao' });
      const json = JSON.stringify(payload);
      expect(json).not.toContain('Asha Rao');
      expect(json).not.toMatch(/phone|password|credential|secret|token_hash/i);
      expect(payload.service_date).toBe('2026-09-07');
    });
  });

  // ───────────────────────────── boards ─────────────────────────────

  describe('boards', () => {
    const rows = [
      makeToken({ id: 't1', token_number: 1, status: QueueTokenStatus.SEATED, seated_at: new Date('2026-09-07T11:00:00Z'), assigned_table_id: TABLE, assigned_table: { id: TABLE, label: 'T5' } }),
      makeToken({ id: 't2', token_number: 2, status: QueueTokenStatus.CALLED, called_at: new Date('2026-09-07T12:00:00Z') }),
      makeToken({ id: 't3', token_number: 3, status: QueueTokenStatus.CALLED, called_at: new Date('2026-09-07T11:30:00Z') }),
      makeToken({ id: 't4', token_number: 4, status: QueueTokenStatus.WAITING }),
      makeToken({ id: 't5', token_number: 5, status: QueueTokenStatus.WAITING }),
      makeToken({ id: 't6', token_number: 6, status: QueueTokenStatus.NO_SHOW }),
      makeToken({ id: 't7', token_number: 7, status: QueueTokenStatus.CANCELLED, customer: { id: CUSTOMER, name: 'Asha Rao' } }),
    ];

    beforeEach(() => {
      prisma.queueToken.findMany.mockResolvedValue(rows);
    });

    it('groups a single branch-day query by status and counts every state', async () => {
      const board = await service.board(BRANCH);
      expect(prisma.queueToken.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.queueToken.findMany.mock.calls[0][0].where.branch_id).toBe(BRANCH);
      expect(board.counts).toEqual({ waiting: 2, called: 2, seated: 1, no_show: 1, cancelled: 1 });
      expect(board.waiting.map((t) => t.token_number)).toEqual([4, 5]);
      expect(board.seated.map((t) => t.token_number)).toEqual([1]);
    });

    it('names the lowest-numbered waiting token as next — first come, first served', async () => {
      const board = await service.board(BRANCH);
      expect(board.next_waiting?.token_number).toBe(4);
    });

    it('has no next when nobody is waiting', async () => {
      prisma.queueToken.findMany.mockResolvedValue(rows.filter((r) => r.status !== QueueTokenStatus.WAITING));
      expect((await service.board(BRANCH)).next_waiting).toBeNull();
    });

    it('orders called parties longest-waiting first, not by token number', async () => {
      const board = await service.board(BRANCH);
      expect(board.called.map((t) => t.token_number)).toEqual([3, 2]);
    });

    it('the admin board carries no customer object', async () => {
      const board = await service.adminBoard(BRANCH);
      expect(board.counts).toEqual({ waiting: 2, called: 2, seated: 1, no_show: 1, cancelled: 1 });
      for (const t of [...board.waiting, ...board.called, ...board.seated]) {
        expect(t).not.toHaveProperty('customer');
      }
      expect(JSON.stringify(board)).not.toContain('Asha Rao');
    });

    it('the customer board exposes numbers and tables only', async () => {
      const board = await service.customerBoard(BRANCH);
      expect(board.now_serving).toEqual([
        { token_number: 3, table_label: null, called_at: new Date('2026-09-07T11:30:00Z') },
        { token_number: 2, table_label: null, called_at: new Date('2026-09-07T12:00:00Z') },
      ]);
      expect(board.recently_seated).toEqual([
        { token_number: 1, table_label: 'T5', called_at: null },
      ]);
      expect(board.waiting_count).toBe(2);

      const json = JSON.stringify(board);
      expect(json).not.toContain('Asha Rao');
      expect(json).not.toContain(CUSTOMER); // not even a customer id
      expect(json).not.toMatch(/party_size|customer|status/i);
    });

    it('boards default to the branch service date and accept an explicit one', async () => {
      vi.setSystemTime(new Date('2026-09-07T19:00:00.000Z')); // 8th in Kolkata
      const today = await service.board(BRANCH);
      expect(today.service_date).toBe('2026-09-08');
      vi.useRealTimers();

      const explicit = await service.board(BRANCH, '2026-09-01');
      expect(explicit.service_date).toBe('2026-09-01');
      await expect(service.board(BRANCH, '2026-02-30')).rejects.toThrow();
    });
  });

  // ───────────────────────────── reads ─────────────────────────────

  describe('list', () => {
    it("defaults to the branch's own service date", async () => {
      vi.setSystemTime(new Date('2026-09-07T19:00:00.000Z')); // 8th in Kolkata
      await service.list({ branchId: BRANCH }, { limit: 50, offset: 0 });
      expect(prisma.queueToken.findMany.mock.calls[0][0].where.service_date.toISOString()).toBe(
        '2026-09-08T00:00:00.000Z',
      );
      vi.useRealTimers();
    });

    it('always pins the branch and applies the status filter', async () => {
      await service.list(
        { branchId: BRANCH },
        { limit: 10, offset: 5, service_date: '2026-09-01', status: QueueTokenStatus.WAITING },
      );
      const args = prisma.queueToken.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ branch_id: BRANCH, status: QueueTokenStatus.WAITING });
      expect(args.take).toBe(10);
      expect(args.skip).toBe(5);
      expect(args.orderBy).toEqual({ token_number: 'asc' });
    });

    it('rejects an impossible calendar date', async () => {
      await expect(
        service.list({ branchId: BRANCH }, { limit: 50, offset: 0, service_date: '2026-02-30' }),
      ).rejects.toThrow();
    });
  });
});

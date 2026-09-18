/**
 * Phase 7 — Queue Management backend (queue token domain + podium operations).
 *
 * Fixture:
 *   companyA ─ branchA   ─ podiumA    (all queue perms + tables/customers view)
 *            │           ├ viewerA    (queue.view only)
 *            │           └ strangerA  (no queue perms at all)
 *            ├ branchA2  ─ podiumA also holds the podium role here
 *            └ branchOff (INACTIVE)   ─ podiumA holds the role here too
 *   companyB ─ branchB   ─ podiumB
 *   companyS (SUSPENDED) ─ branchS    ─ suspendedUser
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  BranchStatus,
  CompanyStatus,
  DisplayDeviceKind,
  DisplayDeviceStatus,
  MembershipStatus,
  UserStatus,
} from '@samco/database';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { EVENT_BROKER, type EventBroker } from '../src/common/realtime/event-broker.js';
import { RealtimeChannel } from '../src/common/realtime/channels.js';
import { QUEUE_EVENT_TYPES, QueueTokensService } from '../src/modules/queue-tokens/queue-tokens.service.js';
import { TablesService } from '../src/modules/tables/tables.service.js';
import { currentServiceDate } from '../src/modules/queue-tokens/queue-service-date.js';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const QUEUE_PERMS = [
  'queue.view',
  'queue.register',
  'queue.call',
  'queue.seat',
  'queue.no_show',
  'queue.cancel',
];
const PODIUM_PERMS = [...QUEUE_PERMS, 'tables.view', 'customers.view', 'customers.create'];

describe('Phase 7 Queue Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let broker: EventBroker;
  let http: any;

  let companyA: any, companyB: any, companyS: any;
  let branchA: any, branchA2: any, branchOff: any, branchB: any, branchS: any;
  let podiumA: any, viewerA: any, strangerA: any, podiumB: any, suspendedUser: any;
  let tokenPodiumA: string, tokenViewerA: string, tokenStrangerA: string;
  let tokenPodiumB: string, tokenSuspended: string;
  let customerA: any, customerB: any;
  let tableA1: any, tableA2: any, tableInactive: any, tableA2Branch: any;

  /** Requests carry context headers; the guards are what actually authorize. */
  const as = (req: request.Test, token: string, companyId: string, branchId?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    if (branchId) req.set('X-Branch-ID', branchId);
    return req;
  };
  const asPodium = (req: request.Test, branchId = branchA.id) =>
    as(req, tokenPodiumA, companyA.id, branchId);

  const register = (body: Record<string, unknown> = { adults: 2 }, branchId = branchA.id) =>
    asPodium(request(http).post('/api/v1/queue-tokens'), branchId).send(body);

  /** Register a token and drive it to CALLED. */
  const registerCalled = async (body: Record<string, unknown> = { adults: 2 }) => {
    const r = await register(body);
    await asPodium(request(http).post(`/api/v1/queue-tokens/${r.body.id}/call`)).send();
    return r.body;
  };

  const registerSeated = async (tableId?: string) => {
    const t = await registerCalled();
    const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send(
      tableId ? { table_id: tableId } : {},
    );
    return res.body;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    broker = app.get(EVENT_BROKER);
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const hash = await bcrypt.hash(PASSWORD, SALT);

    companyA = await prisma.company.create({ data: { name: 'Queue Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Queue Beta', status: CompanyStatus.ACTIVE } });
    companyS = await prisma.company.create({ data: { name: 'Queue Suspended', status: CompanyStatus.SUSPENDED } });

    branchA = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Main', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA2 = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Second', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchOff = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Closed', timezone: 'UTC', status: BranchStatus.INACTIVE } });
    branchB = await prisma.branch.create({ data: { company_id: companyB.id, name: 'Beta Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });
    branchS = await prisma.branch.create({ data: { company_id: companyS.id, name: 'Suspended Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });

    const perms = await prisma.permission.findMany({ where: { name: { in: PODIUM_PERMS } } });
    expect(perms).toHaveLength(PODIUM_PERMS.length); // seed sanity: the Phase 7 keys exist
    const byName = new Map(perms.map((p) => [p.name, p.id]));

    const podiumRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Podium' } });
    const viewerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Queue Viewer' } });
    const strangerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'No Queue' } });
    const podiumRoleB = await prisma.role.create({ data: { company_id: companyB.id, name: 'Podium' } });
    const podiumRoleS = await prisma.role.create({ data: { company_id: companyS.id, name: 'Podium' } });

    await prisma.rolePermission.createMany({
      data: [
        ...PODIUM_PERMS.map((n) => ({ role_id: podiumRoleA.id, permission_id: byName.get(n)! })),
        { role_id: viewerRoleA.id, permission_id: byName.get('queue.view')! },
        { role_id: strangerRoleA.id, permission_id: byName.get('tables.view')! },
        ...PODIUM_PERMS.map((n) => ({ role_id: podiumRoleB.id, permission_id: byName.get(n)! })),
        ...QUEUE_PERMS.map((n) => ({ role_id: podiumRoleS.id, permission_id: byName.get(n)! })),
      ],
    });

    podiumA = await prisma.user.create({ data: { email: 'q-podium-a@test.com', password_hash: hash } });
    viewerA = await prisma.user.create({ data: { email: 'q-viewer-a@test.com', password_hash: hash } });
    strangerA = await prisma.user.create({ data: { email: 'q-stranger-a@test.com', password_hash: hash } });
    podiumB = await prisma.user.create({ data: { email: 'q-podium-b@test.com', password_hash: hash } });
    suspendedUser = await prisma.user.create({ data: { email: 'q-suspended@test.com', password_hash: hash } });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: podiumA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: viewerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: strangerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: podiumB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: suspendedUser.id, company_id: companyS.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: podiumA.id, branch_id: branchA.id, role_id: podiumRoleA.id },
        { user_id: podiumA.id, branch_id: branchA2.id, role_id: podiumRoleA.id },
        { user_id: podiumA.id, branch_id: branchOff.id, role_id: podiumRoleA.id },
        { user_id: viewerA.id, branch_id: branchA.id, role_id: viewerRoleA.id },
        { user_id: strangerA.id, branch_id: branchA.id, role_id: strangerRoleA.id },
        { user_id: podiumB.id, branch_id: branchB.id, role_id: podiumRoleB.id },
        { user_id: suspendedUser.id, branch_id: branchS.id, role_id: podiumRoleS.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body
        .accessToken as string;
    tokenPodiumA = await login('q-podium-a@test.com');
    tokenViewerA = await login('q-viewer-a@test.com');
    tokenStrangerA = await login('q-stranger-a@test.com');
    tokenPodiumB = await login('q-podium-b@test.com');
    tokenSuspended = await login('q-suspended@test.com');

    customerA = await prisma.customer.create({ data: { company_id: companyA.id, name: 'Asha Rao', phone: '+919876500001' } });
    customerB = await prisma.customer.create({ data: { company_id: companyB.id, name: 'Other Co Customer' } });
    tableA1 = await prisma.table.create({ data: { branch_id: branchA.id, label: 'T1', capacity: 4 } });
    tableA2 = await prisma.table.create({ data: { branch_id: branchA.id, label: 'T2', capacity: 2 } });
    tableInactive = await prisma.table.create({ data: { branch_id: branchA.id, label: 'T3', capacity: 2, status: 'INACTIVE' } });
    tableA2Branch = await prisma.table.create({ data: { branch_id: branchA2.id, label: 'X1', capacity: 4 } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REGISTRATION  (Customer Register integration)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Registration', () => {
    it('QR-1. registers an anonymous walk-in as WAITING with a token number', async () => {
      const res = await register({ adults: 3 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        company_id: companyA.id,
        branch_id: branchA.id,
        customer_id: null,
        customer: null,
        status: 'WAITING',
        adults: 3,
        kids: 0,
        party_size: 3,
        advance_booking_at: null,
        assigned_table_id: null,
        called_at: null,
        seated_at: null,
      });
      expect(res.body.token_number).toBeGreaterThan(0);
      expect(res.body.service_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('QR-2. registers against an existing customer of the same company', async () => {
      const res = await register({ adults: 2, customer_id: customerA.id });
      expect(res.status).toBe(201);
      expect(res.body.customer_id).toBe(customerA.id);
      // The projection is id + name only — no phone, no status.
      expect(res.body.customer).toEqual({ id: customerA.id, name: 'Asha Rao' });
      expect(JSON.stringify(res.body)).not.toContain('9876500001');
    });

    it('QR-3. rejects a customer from another company as 404 (no existence disclosure)', async () => {
      const res = await register({ adults: 2, customer_id: customerB.id });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Other Co Customer');
    });

    it('QR-4. rejects an inactive customer with 409', async () => {
      const inactive = await prisma.customer.create({
        data: { company_id: companyA.id, name: 'Dormant', status: 'INACTIVE' },
      });
      const res = await register({ adults: 2, customer_id: inactive.id });
      expect(res.status).toBe(409);
    });

    it('QR-5. never requires a phone and never creates a customer implicitly', async () => {
      const before = await prisma.customer.count({ where: { company_id: companyA.id } });
      const res = await register({ adults: 1 });
      expect(res.status).toBe(201);
      expect(await prisma.customer.count({ where: { company_id: companyA.id } })).toBe(before);
    });

    it('QR-6. allocates sequential numbers per branch and service date', async () => {
      const branch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Seq', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({
        data: { user_id: podiumA.id, branch_id: branch.id, role_id: role!.id },
      });

      const numbers: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await register({ adults: 2 }, branch.id);
        numbers.push(res.body.token_number);
      }
      expect(numbers).toEqual([1, 2, 3]);
    });

    it('QR-7. numbering is isolated per branch', async () => {
      const a2 = await register({ adults: 2 }, branchA2.id);
      expect(a2.status).toBe(201);
      // branchA2 has its own counter, so it starts at 1 regardless of branchA.
      expect(a2.body.token_number).toBe(1);
      expect(a2.body.branch_id).toBe(branchA2.id);
    });

    it('QR-8. uses the BRANCH timezone for the service date', async () => {
      const res = await register({ adults: 2 });
      expect(res.body.service_date).toBe(currentServiceDate('Asia/Kolkata'));
    });

    it('QR-9. validates the payload and rejects unknown fields', async () => {
      const cases = [
        [{}, 400],
        [{ adults: 0 }, 400],
        [{ adults: -1 }, 400],
        [{ adults: 1.5 }, 400],
        [{ adults: 101 }, 400],
        [{ adults: 'two' }, 400],
        [{ adults: 2, kids: -1 }, 400],
        [{ adults: 2, kids: 1.5 }, 400],
        [{ adults: 2, customer_id: 'not-a-uuid' }, 400],
        // The TOTAL is derived, never sent: a client cannot post a party_size
        // that disagrees with the split, because it cannot post one at all.
        [{ adults: 2, party_size: 99 }, 400],
        [{ party_size: 2 }, 400],
        // Status is not client-settable anywhere, including at registration.
        [{ adults: 2, status: 'SEATED' }, 400],
        [{ adults: 2, token_number: 99 }, 400],
        [{ adults: 2, branch_id: branchB.id }, 400],
        // An advance booking is an instant, in the future, within the horizon.
        [{ adults: 2, advance_booking_at: 'tomorrow' }, 400],
        [{ adults: 2, advance_booking_at: '2020-01-01T10:00:00.000Z' }, 400],
        [
          { adults: 2, advance_booking_at: new Date(Date.now() + 40 * 3_600_000).toISOString() },
          400,
        ],
      ] as const;
      for (const [body, expected] of cases) {
        const res = await register(body as Record<string, unknown>);
        expect([body, res.status]).toEqual([body, expected]);
      }
    });

    it('QR-10. writes a REGISTERED history row and an audit record', async () => {
      const res = await register({ adults: 2 });
      const events = await prisma.queueTokenEvent.findMany({ where: { queue_token_id: res.body.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'REGISTERED',
        previous_status: null,
        new_status: 'WAITING',
        actor_user_id: podiumA.id,
      });

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'QUEUE_TOKEN', entity_id: res.body.id },
      });
      expect(audit).toMatchObject({
        event_type: 'CREATE',
        company_id: companyA.id,
        branch_id: branchA.id,
        user_id: podiumA.id,
      });
      expect(audit!.payload).toMatchObject({ action: 'register' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING / DETAIL  (podium queue view)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Listing and detail', () => {
    it('QL-1. lists today\'s tokens for the branch, ordered by token number', async () => {
      const res = await asPodium(request(http).get('/api/v1/queue-tokens')).query({ limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ limit: 100, offset: 0 });
      const numbers = res.body.data.map((t: any) => t.token_number);
      expect([...numbers].sort((a: number, b: number) => a - b)).toEqual(numbers);
      res.body.data.forEach((t: any) => {
        expect(t.branch_id).toBe(branchA.id);
        expect(t.service_date).toBe(currentServiceDate('Asia/Kolkata'));
      });
    });

    it('QL-2. filters by status', async () => {
      await registerCalled();
      const res = await asPodium(request(http).get('/api/v1/queue-tokens')).query({
        status: 'CALLED',
        limit: 100,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((t: any) => expect(t.status).toBe('CALLED'));
    });

    it('QL-3. filters by service date and returns an empty page for another day', async () => {
      const res = await asPodium(request(http).get('/api/v1/queue-tokens')).query({
        service_date: '2020-01-01',
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('QL-4. rejects malformed and impossible service dates', async () => {
      for (const d of ['07-09-2026', 'today', '2026-02-30']) {
        const res = await asPodium(request(http).get('/api/v1/queue-tokens')).query({ service_date: d });
        expect([d, res.status]).toEqual([d, 400]);
      }
    });

    it('QL-5. paginates', async () => {
      const page = await asPodium(request(http).get('/api/v1/queue-tokens')).query({ limit: 1, offset: 0 });
      expect(page.status).toBe(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBeGreaterThan(1);
    });

    it('QL-6. detail returns the token with its append-only lifecycle history', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).get(`/api/v1/queue-tokens/${t.id}`));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(t.id);
      expect(res.body.events.map((e: any) => e.event_type)).toEqual(['REGISTERED', 'CALLED']);
      expect(res.body.events[1]).toMatchObject({
        previous_status: 'WAITING',
        new_status: 'CALLED',
        actor_user_id: podiumA.id,
      });
    });

    it('QL-7. a token of another branch is 404, not 403', async () => {
      const mine = await register();
      const res = await as(
        request(http).get(`/api/v1/queue-tokens/${mine.body.id}`),
        tokenPodiumA,
        companyA.id,
        branchA2.id,
      );
      expect(res.status).toBe(404);
    });

    it('QL-8. a token of another company is 404', async () => {
      const mine = await register();
      const res = await as(
        request(http).get(`/api/v1/queue-tokens/${mine.body.id}`),
        tokenPodiumB,
        companyB.id,
        branchB.id,
      );
      expect(res.status).toBe(404);
    });

    it('QL-9. rejects a non-UUID id', async () => {
      const res = await asPodium(request(http).get('/api/v1/queue-tokens/not-a-uuid'));
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE MACHINE  (podium operations)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Queue state machine over HTTP', () => {
    it('QS-1. call moves WAITING -> CALLED and stamps called_at', async () => {
      const t = await register();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/call`)).send();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CALLED');
      expect(res.body.called_at).not.toBeNull();
    });

    it('QS-2. seat moves CALLED -> SEATED', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SEATED');
      expect(res.body.seated_at).not.toBeNull();
    });

    it('QS-3. no-show moves CALLED -> NO_SHOW', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/no-show`)).send();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NO_SHOW');
      expect(res.body.no_show_at).not.toBeNull();
    });

    it('QS-4. cancel works from WAITING and from CALLED', async () => {
      const waiting = await register();
      const c1 = await asPodium(request(http).post(`/api/v1/queue-tokens/${waiting.body.id}/cancel`)).send();
      expect(c1.status).toBe(200);
      expect(c1.body.status).toBe('CANCELLED');

      const called = await registerCalled();
      const c2 = await asPodium(request(http).post(`/api/v1/queue-tokens/${called.id}/cancel`)).send();
      expect(c2.status).toBe(200);
      expect(c2.body.status).toBe('CANCELLED');
    });

    it('QS-5. seating a WAITING token is rejected — CALLED cannot be skipped', async () => {
      const t = await register();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/seat`)).send({});
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/WAITING/);
      const after = await prisma.queueToken.findUnique({ where: { id: t.body.id } });
      expect(after!.status).toBe('WAITING'); // unchanged
    });

    it('QS-6. no-show on a WAITING token is rejected', async () => {
      const t = await register();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/no-show`)).send();
      expect(res.status).toBe(409);
    });

    it('QS-7. terminal states are terminal', async () => {
      const seated = await registerSeated();
      for (const op of ['call', 'seat', 'no-show', 'cancel']) {
        const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${seated.id}/${op}`)).send({});
        expect([op, res.status]).toEqual([op, 409]);
      }

      const cancelledRes = await register();
      await asPodium(request(http).post(`/api/v1/queue-tokens/${cancelledRes.body.id}/cancel`)).send();
      for (const op of ['call', 'seat', 'no-show', 'cancel']) {
        const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${cancelledRes.body.id}/${op}`)).send({});
        expect([op, res.status]).toEqual([op, 409]);
      }
    });

    it('QS-8. repeating an operation is rejected the second time', async () => {
      const t = await register();
      const first = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/call`)).send();
      const second = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/call`)).send();
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      const events = await prisma.queueTokenEvent.findMany({ where: { queue_token_id: t.body.id } });
      expect(events.filter((e) => e.event_type === 'CALLED')).toHaveLength(1);
    });

    it('QS-9. there is NO route that mutates status directly', async () => {
      const t = await register();
      const patch = await asPodium(request(http).patch(`/api/v1/queue-tokens/${t.body.id}`)).send({
        status: 'SEATED',
      });
      expect([404, 405]).toContain(patch.status);

      const put = await asPodium(request(http).put(`/api/v1/queue-tokens/${t.body.id}`)).send({
        status: 'SEATED',
      });
      expect([404, 405]).toContain(put.status);

      const after = await prisma.queueToken.findUnique({ where: { id: t.body.id } });
      expect(after!.status).toBe('WAITING');
    });

    it('QS-10. every transition appends history and audit; history is append-only', async () => {
      const t = await registerCalled();
      await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({});

      const events = await prisma.queueTokenEvent.findMany({
        where: { queue_token_id: t.id },
        orderBy: { created_at: 'asc' },
      });
      expect(events.map((e) => e.event_type)).toEqual(['REGISTERED', 'CALLED', 'SEATED']);

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'QUEUE_TOKEN', entity_id: t.id },
      });
      expect(audits.length).toBeGreaterThanOrEqual(3);

      // The database rejects rewriting history, exactly like audit_logs.
      await expect(
        prisma.queueTokenEvent.update({
          where: { id: events[0].id },
          data: { new_status: 'SEATED' },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.queueTokenEvent.delete({ where: { id: events[0].id } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE ASSIGNMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Table assignment', () => {
    it('QT-1. seats a party onto a table in one operation', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({
        table_id: tableA1.id,
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SEATED');
      expect(res.body.assigned_table_id).toBe(tableA1.id);
      expect(res.body.assigned_table).toEqual({ id: tableA1.id, label: 'T1' });

      const events = await prisma.queueTokenEvent.findMany({
        where: { queue_token_id: t.id },
        orderBy: { created_at: 'asc' },
      });
      expect(events.map((e) => e.event_type)).toEqual(['REGISTERED', 'CALLED', 'SEATED', 'TABLE_ASSIGNED']);
      expect(events[3].metadata).toEqual({ table_id: tableA1.id });

      // release so later tests can reuse T1
      await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/release-table`)).send();
    });

    it('QT-2. assigns and releases a table after seating', async () => {
      const seated = await registerSeated();
      const assign = await asPodium(
        request(http).post(`/api/v1/queue-tokens/${seated.id}/assign-table`),
      ).send({ table_id: tableA2.id });
      expect(assign.status).toBe(200);
      expect(assign.body.assigned_table_id).toBe(tableA2.id);

      const release = await asPodium(
        request(http).post(`/api/v1/queue-tokens/${seated.id}/release-table`),
      ).send();
      expect(release.status).toBe(200);
      expect(release.body.assigned_table_id).toBeNull();
      expect(release.body.status).toBe('SEATED'); // releasing does not change the lifecycle

      // The assignment survives in history even though the field is cleared.
      const events = await prisma.queueTokenEvent.findMany({ where: { queue_token_id: seated.id } });
      const released = events.find((e) => e.event_type === 'TABLE_RELEASED');
      expect(released!.metadata).toEqual({ table_id: tableA2.id });
    });

    it('QT-3. rejects a table from another branch as 404', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({
        table_id: tableA2Branch.id,
      });
      expect(res.status).toBe(404);
      const after = await prisma.queueToken.findUnique({ where: { id: t.id } });
      expect(after!.status).toBe('CALLED'); // the whole operation rolled back
    });

    it('QT-4. rejects an inactive table with 409', async () => {
      const t = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({
        table_id: tableInactive.id,
      });
      expect(res.status).toBe(409);
    });

    it('QT-5. a table held by a seated party cannot be given to another', async () => {
      const holder = await registerSeated(tableA1.id);
      expect(holder.assigned_table_id).toBe(tableA1.id);

      const other = await registerCalled();
      const res = await asPodium(request(http).post(`/api/v1/queue-tokens/${other.id}/seat`)).send({
        table_id: tableA1.id,
      });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/occupied/i);

      // Freeing it makes the table assignable again.
      await asPodium(request(http).post(`/api/v1/queue-tokens/${holder.id}/release-table`)).send();
      const retry = await asPodium(request(http).post(`/api/v1/queue-tokens/${other.id}/seat`)).send({
        table_id: tableA1.id,
      });
      expect(retry.status).toBe(200);
      await asPodium(request(http).post(`/api/v1/queue-tokens/${other.id}/release-table`)).send();
    });

    it('QT-6. only a seated party can hold a table', async () => {
      const waiting = await register();
      const res = await asPodium(
        request(http).post(`/api/v1/queue-tokens/${waiting.body.id}/assign-table`),
      ).send({ table_id: tableA2.id });
      expect(res.status).toBe(409);
    });

    it('QT-7. releasing when no table is held is rejected', async () => {
      const seated = await registerSeated();
      const res = await asPodium(
        request(http).post(`/api/v1/queue-tokens/${seated.id}/release-table`),
      ).send();
      expect(res.status).toBe(409);
    });

    it('QT-8. validates table_id', async () => {
      const seated = await registerSeated();
      for (const body of [{}, { table_id: 'nope' }, { table_id: tableA2.id, extra: 1 }]) {
        const res = await asPodium(
          request(http).post(`/api/v1/queue-tokens/${seated.id}/assign-table`),
        ).send(body);
        expect([body, res.status]).toEqual([body, 400]);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('QA-1. rejects an unauthenticated request', async () => {
      const res = await request(http)
        .post('/api/v1/queue-tokens')
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ adults: 2 });
      expect(res.status).toBe(401);
    });

    it('QA-2. queue.view alone cannot mutate', async () => {
      const t = await register();
      const list = await as(request(http).get('/api/v1/queue-tokens'), tokenViewerA, companyA.id, branchA.id);
      expect(list.status).toBe(200);

      for (const [method, path] of [
        ['post', '/api/v1/queue-tokens'],
        ['post', `/api/v1/queue-tokens/${t.body.id}/call`],
        ['post', `/api/v1/queue-tokens/${t.body.id}/seat`],
        ['post', `/api/v1/queue-tokens/${t.body.id}/no-show`],
        ['post', `/api/v1/queue-tokens/${t.body.id}/cancel`],
        ['post', `/api/v1/queue-tokens/${t.body.id}/assign-table`],
      ] as const) {
        const res = await as(
          (request(http) as any)[method](path),
          tokenViewerA,
          companyA.id,
          branchA.id,
        ).send({ adults: 2, table_id: tableA2.id });
        expect([path, res.status]).toEqual([path, 403]);
      }
    });

    it('QA-3. a user with no queue permission is refused even to read', async () => {
      const res = await as(request(http).get('/api/v1/queue-tokens'), tokenStrangerA, companyA.id, branchA.id);
      expect(res.status).toBe(403);
    });

    it('QA-4. X-Branch-ID is not authorization: a branch where the user holds no role is refused', async () => {
      const res = await as(
        request(http).post('/api/v1/queue-tokens'),
        tokenPodiumA,
        companyA.id,
        branchB.id, // another company's branch entirely
      ).send({ adults: 2 });
      expect(res.status).toBe(403);
    });

    it('QA-5. cross-company header spoofing is refused', async () => {
      const res = await as(
        request(http).post('/api/v1/queue-tokens'),
        tokenPodiumB, // company B user
        companyA.id, // claiming company A
        branchA.id,
      ).send({ adults: 2 });
      expect(res.status).toBe(403);
    });

    it('QA-6. an INACTIVE branch cannot be used even by a role-holder', async () => {
      const res = await as(
        request(http).post('/api/v1/queue-tokens'),
        tokenPodiumA,
        companyA.id,
        branchOff.id,
      ).send({ adults: 2 });
      expect(res.status).toBe(403);
    });

    it('QA-7. a SUSPENDED company is refused', async () => {
      const res = await as(
        request(http).post('/api/v1/queue-tokens'),
        tokenSuspended,
        companyS.id,
        branchS.id,
      ).send({ adults: 2 });
      expect(res.status).toBe(403);
    });

    it('QA-8. an INACTIVE membership is refused', async () => {
      const email = 'q-membership@test.com';
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const user = await prisma.user.create({ data: { email, password_hash: hash } });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: user.id, branch_id: branchA.id, role_id: role!.id },
      });
      const token = (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }))
        .body.accessToken as string;

      const ok = await as(request(http).get('/api/v1/queue-tokens'), token, companyA.id, branchA.id);
      expect(ok.status).toBe(200);

      await prisma.companyMembership.updateMany({
        where: { user_id: user.id, company_id: companyA.id },
        data: { status: MembershipStatus.INACTIVE },
      });
      const after = await as(request(http).get('/api/v1/queue-tokens'), token, companyA.id, branchA.id);
      expect(after.status).toBe(403);
    });

    it('QA-9. a globally disabled user cannot use an already-issued token', async () => {
      const email = 'q-disabled@test.com';
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const user = await prisma.user.create({ data: { email, password_hash: hash } });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: user.id, branch_id: branchA.id, role_id: role!.id },
      });
      const token = (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }))
        .body.accessToken as string;

      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.INACTIVE } });
      const res = await as(request(http).get('/api/v1/queue-tokens'), token, companyA.id, branchA.id);
      expect(res.status).toBe(401);
    });

    it('QA-10. missing context headers are refused', async () => {
      const noBranch = await request(http)
        .post('/api/v1/queue-tokens')
        .set('Authorization', `Bearer ${tokenPodiumA}`)
        .set('X-Company-ID', companyA.id)
        .send({ adults: 2 });
      expect(noBranch.status).toBe(403);

      const noCompany = await request(http)
        .get('/api/v1/queue-tokens')
        .set('Authorization', `Bearer ${tokenPodiumA}`)
        .set('X-Branch-ID', branchA.id);
      expect(noCompany.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REALTIME  (publishes through the T0-B broker, after commit)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Realtime publication', () => {
    // Built lazily: the fixture ids do not exist when describe() bodies run.
    const scopeA = (branchId: string) => ({
      companyId: companyA.id,
      branchId,
      channel: RealtimeChannel.QUEUE,
    });

    const collect = (branchId: string, count: number, timeoutMs = 4000) =>
      new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        const sub = broker
          .subscribe(scopeA(branchId))
          .subscribe((e) => {
            events.push(e);
            if (events.length >= count) {
              sub.unsubscribe();
              clearTimeout(timer);
              resolve(events);
            }
          });
        const timer = setTimeout(() => {
          sub.unsubscribe();
          reject(new Error(`timed out with ${events.length}/${count} events`));
        }, timeoutMs);
      });

    it('QE-1. publishes registered/called/seated on the branch queue channel', async () => {
      const wait = collect(branchA.id, 3);
      const t = await register({ adults: 2 });
      await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/call`)).send();
      await asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/seat`)).send({});
      const events = await wait;

      expect(events.map((e) => e.type)).toEqual([
        QUEUE_EVENT_TYPES.REGISTERED,
        QUEUE_EVENT_TYPES.CALLED,
        QUEUE_EVENT_TYPES.SEATED,
      ]);
      expect(events.map((e) => e.id)).toEqual([...events].map((e) => e.id).sort((a, b) => a - b));
    });

    it('QE-2. publishes no-show and cancelled', async () => {
      // Prepare both tokens BEFORE subscribing, so the window contains only
      // the two terminal events under test.
      const noShow = await registerCalled();
      const cancelled = await registerCalled();

      const wait = collect(branchA.id, 2);
      await asPodium(request(http).post(`/api/v1/queue-tokens/${noShow.id}/no-show`)).send();
      await asPodium(request(http).post(`/api/v1/queue-tokens/${cancelled.id}/cancel`)).send();

      expect((await wait).map((e) => e.type)).toEqual([
        QUEUE_EVENT_TYPES.NO_SHOW,
        QUEUE_EVENT_TYPES.CANCELLED,
      ]);
    });

    it('QE-3. the payload is display-safe — no PII, credentials or tokens', async () => {
      const wait = collect(branchA.id, 1);
      await register({ adults: 2, customer_id: customerA.id });
      const [event] = await wait;

      expect(event.data).toMatchObject({
        branch_id: branchA.id,
        company_id: companyA.id,
        status: 'WAITING',
      });
      // The queue channel is shared with dining-room screens, so the broadcast
      // carries no customer identity — only the opaque id for correlation.
      expect(event.data).not.toHaveProperty('customer');
      expect(event.data.customer_id).toBe(customerA.id);
      const json = JSON.stringify(event.data);
      expect(json).not.toContain('Asha Rao'); // name
      expect(json).not.toContain('9876500001'); // phone
      expect(json).not.toMatch(/password|credential|secret|hash|Bearer|accessToken/i);
    });

    it('QE-4. a failed mutation publishes nothing', async () => {
      const seen: any[] = [];
      const sub = broker.subscribe(scopeA(branchA.id)).subscribe((e) => seen.push(e));
      const waiting = await register(); // this one publishes
      const before = seen.length;

      // Invalid transition — rolls back, must not publish.
      const bad = await asPodium(request(http).post(`/api/v1/queue-tokens/${waiting.body.id}/seat`)).send({});
      expect(bad.status).toBe(409);
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.length).toBe(before);
      sub.unsubscribe();
    });

    it('QE-5. events do not leak across branches', async () => {
      const otherBranch: any[] = [];
      const sub = broker.subscribe(scopeA(branchA2.id)).subscribe((e) => otherBranch.push(e));
      const wait = collect(branchA.id, 1);
      await register({ adults: 2 });
      await wait;
      await new Promise((r) => setTimeout(r, 50));
      expect(otherBranch).toHaveLength(0);
      sub.unsubscribe();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCURRENCY  (database-enforced, not application-only)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Concurrency', () => {
    it('QC-1. 12 simultaneous registrations produce 12 distinct sequential numbers', async () => {
      const branch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Race One', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({
        data: { user_id: podiumA.id, branch_id: branch.id, role_id: role!.id },
      });

      const results = await Promise.all(
        Array.from({ length: 12 }, () => register({ adults: 2 }, branch.id)),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);

      const numbers = results.map((r) => r.body.token_number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(12);
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));

      const counter = await prisma.queueCounter.findFirst({ where: { branch_id: branch.id } });
      expect(counter!.next_number).toBe(13);
    });

    it('QC-2. simultaneous calls on one token: exactly one succeeds', async () => {
      const t = await register();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          asPodium(request(http).post(`/api/v1/queue-tokens/${t.body.id}/call`)).send(),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);

      const events = await prisma.queueTokenEvent.findMany({
        where: { queue_token_id: t.body.id, event_type: 'CALLED' },
      });
      expect(events).toHaveLength(1);
    });

    it('QC-3. simultaneous seats onto one table: exactly one succeeds', async () => {
      const table = await prisma.table.create({
        data: { branch_id: branchA.id, label: `Race-${Date.now()}`, capacity: 4 },
      });
      const tokens = await Promise.all([registerCalled(), registerCalled(), registerCalled()]);

      const results = await Promise.all(
        tokens.map((t) =>
          asPodium(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({ table_id: table.id }),
        ),
      );
      const ok = results.filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);
      results
        .filter((r) => r.status !== 200)
        .forEach((r) => expect([409, 500]).toContain(r.status) && expect(r.status).toBe(409));

      // The database is the authority: exactly one seated holder for the table.
      const holders = await prisma.queueToken.findMany({
        where: { assigned_table_id: table.id, status: 'SEATED' },
      });
      expect(holders).toHaveLength(1);
    });

    it('QC-4. the partial unique index rejects a second seated holder at the DB level', async () => {
      const table = await prisma.table.create({
        data: { branch_id: branchA.id, label: `Direct-${Date.now()}`, capacity: 4 },
      });
      const holder = await registerSeated(table.id);
      expect(holder.assigned_table_id).toBe(table.id);

      // Bypass the service entirely — the constraint must still hold.
      const other = await registerSeated();
      await expect(
        prisma.queueToken.update({
          where: { id: other.id },
          data: { assigned_table_id: table.id },
        }),
      ).rejects.toThrow();

      await asPodium(request(http).post(`/api/v1/queue-tokens/${holder.id}/release-table`)).send();
    });

    it('QC-5. the unique index rejects a duplicate token number at the DB level', async () => {
        const existing = await prisma.queueToken.findFirst({ where: { branch_id: branchA.id } });
        await expect(
          prisma.queueToken.create({
            data: {
              company_id: companyA.id,
              branch_id: branchA.id,
              service_date: existing!.service_date,
              token_number: existing!.token_number,
              adults: 2,
              party_size: 2,
            },
          }),
        ).rejects.toThrow();
      });
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFORMANCE: skip, scheduled bookings, contact, table availability
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Skip, scheduled bookings, contact and tables', () => {
    let sBranch: any;
    const onS = (req: request.Test) => as(req, tokenPodiumA, companyA.id, sBranch.id);
    const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

    beforeAll(async () => {
      sBranch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Conformance Branch', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({ data: { user_id: podiumA.id, branch_id: sBranch.id, role_id: role!.id } });
    });

    it('QK-1. skip returns a called party to the list, behind everyone not yet called', async () => {
      const first = (await register({ adults: 2 }, sBranch.id)).body;
      const second = (await register({ adults: 2 }, sBranch.id)).body;
      await onS(request(http).post(`/api/v1/queue-tokens/${first.id}/call`)).send();

      const skipped = await onS(request(http).post(`/api/v1/queue-tokens/${first.id}/skip`)).send();
      expect(skipped.status).toBe(200);
      expect(skipped.body).toMatchObject({ status: 'WAITING', called_at: null, skip_count: 1 });
      expect(skipped.body.skipped_at).toBeTruthy();

      const board = (await onS(request(http).get('/api/v1/queue-tokens/board'))).body;
      // Lower number, but skipped: the never-called party is next.
      expect(board.next_waiting.id).toBe(second.id);
      expect(board.waiting.map((t: any) => t.id)).toEqual([second.id, first.id]);

      const events = await prisma.queueTokenEvent.findMany({
        where: { queue_token_id: first.id },
        orderBy: { created_at: 'asc' },
      });
      expect(events.map((e) => e.event_type)).toEqual(['REGISTERED', 'CALLED', 'SKIPPED']);
      // Clean up so later tests see an empty waiting list.
      for (const t of [first, second]) await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/cancel`)).send();
    });

    it('QK-2. skip is refused for a party that has not been called, and for a viewer', async () => {
      const t = (await register({ adults: 2 }, sBranch.id)).body;
      expect((await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/skip`)).send()).status).toBe(409);
      const viewer = await as(request(http).post(`/api/v1/queue-tokens/${t.id}/skip`), tokenViewerA, companyA.id, branchA.id).send();
      expect([403, 404]).toContain(viewer.status);
      await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/cancel`)).send();
    });

    it('QK-3. an advance booking is held SCHEDULED: not waiting, not next, not callable', async () => {
      const booked = await register({ adults: 4, advance_booking_at: inMinutes(3) }, sBranch.id);
      expect(booked.status).toBe(201);
      expect(booked.body.status).toBe('SCHEDULED');

      const board = (await onS(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(board.counts.scheduled).toBeGreaterThanOrEqual(1);
      expect(board.scheduled.map((t: any) => t.id)).toContain(booked.body.id);
      expect(board.waiting.map((t: any) => t.id)).not.toContain(booked.body.id);

      expect((await onS(request(http).post(`/api/v1/queue-tokens/${booked.body.id}/call`)).send()).status).toBe(409);
    });

    it('QK-4. a scheduled party is checked in by staff with queue.register', async () => {
      const booked = (await register({ adults: 2, advance_booking_at: inMinutes(3) }, sBranch.id)).body;
      const viewer = await as(
        request(http).post(`/api/v1/queue-tokens/${booked.id}/check-in`),
        tokenViewerA,
        companyA.id,
        branchA.id,
      ).send();
      expect(viewer.status).toBe(403);

      const res = await onS(request(http).post(`/api/v1/queue-tokens/${booked.id}/check-in`)).send();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('WAITING');
      expect((await onS(request(http).post(`/api/v1/queue-tokens/${booked.id}/check-in`)).send()).status).toBe(409);
      await onS(request(http).post(`/api/v1/queue-tokens/${booked.id}/cancel`)).send();
    });

    it('QK-5. due bookings surface automatically, once, however many runners race', async () => {
      const service = app.get(QueueTokensService);
      const booked = (await register({ adults: 2, advance_booking_at: inMinutes(3) }, sBranch.id)).body;

      // Not yet due: nothing moves.
      await service.activateDueScheduled(new Date());
      expect((await prisma.queueToken.findUnique({ where: { id: booked.id } }))!.status).toBe('SCHEDULED');

      // Due: three runners at once (as on three replicas) activate it exactly once.
      const later = new Date(Date.now() + 10 * 60_000);
      await Promise.all([
        service.activateDueScheduled(later),
        service.activateDueScheduled(later),
        service.activateDueScheduled(later),
      ]);
      expect((await prisma.queueToken.findUnique({ where: { id: booked.id } }))!.status).toBe('WAITING');
      const activations = await prisma.queueTokenEvent.findMany({
        where: { queue_token_id: booked.id, event_type: 'ACTIVATED' },
      });
      expect(activations).toHaveLength(1);
      expect(activations[0].actor_user_id).toBeNull();

      // Attributed to the tenant, with no human actor.
      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'QUEUE_TOKEN', entity_id: booked.id, payload: { path: ['action'], equals: 'activate_scheduled' } },
      });
      expect(audit).toMatchObject({ company_id: companyA.id, branch_id: sBranch.id, user_id: null });
      await onS(request(http).post(`/api/v1/queue-tokens/${booked.id}/cancel`)).send();
    });

    it('QK-6. an advance booking for another day is refused', async () => {
      // Almost 24 hours ahead: inside the old horizon, but on the NEXT
      // branch-local service date unless the current day has only just begun.
      // Whichever day it lands on, the response must agree with the rule.
      const res = await register({ adults: 2, advance_booking_at: new Date(Date.now() + 23.9 * 3_600_000).toISOString() }, sBranch.id);
      const sameDay =
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 23.9 * 3_600_000)) ===
        currentServiceDate('Asia/Kolkata');
      expect(res.status).toBe(sameDay ? 201 : 400);
      if (res.status === 201) await onS(request(http).post(`/api/v1/queue-tokens/${res.body.id}/cancel`)).send();
    });

    it('QK-7. a phone number is released only to queue.call + customers.view, and the read is audited', async () => {
      const named = (await register({ adults: 2, customer_id: customerA.id }, sBranch.id)).body;
      const res = await onS(request(http).get(`/api/v1/queue-tokens/${named.id}/contact`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token_id: named.id,
        customer_name: 'Asha Rao',
        phone: '+919876500001',
        tel_url: 'tel:+919876500001',
        whatsapp_url: 'https://wa.me/919876500001',
      });

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'QUEUE_TOKEN', entity_id: named.id, event_type: 'SECURITY' },
      });
      expect(audit!.payload).toMatchObject({ action: 'view_contact' });
      expect(JSON.stringify(audit!.payload)).not.toContain('9876500001');

      // queue.view alone: refused at the guard.
      const viewer = await as(request(http).get(`/api/v1/queue-tokens/${named.id}/contact`), tokenViewerA, companyA.id, branchA.id);
      expect(viewer.status).toBe(403);

      // queue.call without customers.view: refused too.
      const perms = await prisma.permission.findMany({ where: { name: { in: ['queue.view', 'queue.call'] } } });
      const callerRole = await prisma.role.create({ data: { company_id: companyA.id, name: 'Caller only' } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: callerRole.id, permission_id: p.id })) });
      const caller = await prisma.user.create({
        data: { email: 'q-caller-a@test.com', password_hash: await bcrypt.hash(PASSWORD, SALT) },
      });
      await prisma.companyMembership.create({ data: { user_id: caller.id, company_id: companyA.id, status: MembershipStatus.ACTIVE } });
      await prisma.userBranchRole.create({ data: { user_id: caller.id, branch_id: sBranch.id, role_id: callerRole.id } });
      const callerToken = (
        await request(http).post('/api/v1/auth/login').send({ email: 'q-caller-a@test.com', password: PASSWORD })
      ).body.accessToken;
      const noCustomers = await as(request(http).get(`/api/v1/queue-tokens/${named.id}/contact`), callerToken, companyA.id, sBranch.id);
      expect(noCustomers.status).toBe(403);

      // A walk-in has no number to give.
      const walkIn = (await register({ adults: 1 }, sBranch.id)).body;
      expect((await onS(request(http).get(`/api/v1/queue-tokens/${walkIn.id}/contact`))).status).toBe(404);

      for (const t of [named, walkIn]) await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/cancel`)).send();
    });

    it('QK-8. table availability sees a party still seated from an earlier day, and such a table cannot be deactivated', async () => {
      const table = await prisma.table.create({ data: { branch_id: sBranch.id, label: 'OVERNIGHT', capacity: 4 } });
      const t = (await register({ adults: 2 }, sBranch.id)).body;
      await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/call`)).send();
      await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/seat`)).send({ table_id: table.id });
      // The party was seated before midnight: its token belongs to a past day.
      await prisma.queueToken.update({ where: { id: t.id }, data: { service_date: new Date('2020-01-01T00:00:00.000Z') } });

      const res = await onS(request(http).get('/api/v1/queue-tokens/table-availability'));
      expect(res.status).toBe(200);
      const row = res.body.find((x: any) => x.id === table.id);
      expect(row.occupied_by).toEqual({ token_id: t.id, token_number: t.token_number, service_date: '2020-01-01' });

      const tables = app.get(TablesService);
      await expect(
        tables.updateTable(table.id, sBranch.id, companyA.id, { status: 'INACTIVE' } as any, podiumA.id),
      ).rejects.toThrow(/occupied/);

      await onS(request(http).post(`/api/v1/queue-tokens/${t.id}/release-table`)).send();
      const freed = (await onS(request(http).get('/api/v1/queue-tokens/table-availability'))).body.find((x: any) => x.id === table.id);
      expect(freed.occupied_by).toBeNull();
      await expect(
        tables.updateTable(table.id, sBranch.id, companyA.id, { status: 'INACTIVE' } as any, podiumA.id),
      ).resolves.toMatchObject({ status: 'INACTIVE' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PODIUM BOARD  (the operator's working view)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Podium board', () => {
    let boardBranch: any;
    const onBoard = (req: request.Test) => as(req, tokenPodiumA, companyA.id, boardBranch.id);

    beforeAll(async () => {
      boardBranch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Board Branch', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({
        data: { user_id: podiumA.id, branch_id: boardBranch.id, role_id: role!.id },
      });
    });

    it('QB-1. starts empty with zeroed counts and no next party', async () => {
      const res = await onBoard(request(http).get('/api/v1/queue-tokens/board'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        branch_id: boardBranch.id,
        service_date: currentServiceDate('Asia/Kolkata'),
        next_token_number: 1,
        counts: { waiting: 0, called: 0, seated: 0, no_show: 0, cancelled: 0 },
        next_waiting: null,
        waiting: [],
        called: [],
        seated: [],
      });
    });

    it('QB-2. tracks the whole lifecycle and always names the next waiting party', async () => {
      const table = await prisma.table.create({
        data: { branch_id: boardBranch.id, label: 'B1', capacity: 4 },
      });
      const t1 = await register({ adults: 2 }, boardBranch.id);
      const t2 = await register({ adults: 4 }, boardBranch.id);
      const t3 = await register({ adults: 3 }, boardBranch.id);

      let board = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(board.counts.waiting).toBe(3);
      expect(board.next_waiting.token_number).toBe(t1.body.token_number);
      // The preview is the counter's next value, and reading it does not consume it.
      expect(board.next_token_number).toBe(t3.body.token_number + 1);
      const again = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(again.next_token_number).toBe(t3.body.token_number + 1);

      await onBoard(request(http).post(`/api/v1/queue-tokens/${t1.body.id}/call`)).send();
      board = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      // The called party leaves the waiting list; the next one moves up.
      expect(board.counts).toMatchObject({ waiting: 2, called: 1 });
      expect(board.next_waiting.token_number).toBe(t2.body.token_number);
      expect(board.called[0].id).toBe(t1.body.id);

      await onBoard(request(http).post(`/api/v1/queue-tokens/${t1.body.id}/seat`)).send({
        table_id: table.id,
      });
      board = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(board.counts).toMatchObject({ waiting: 2, called: 0, seated: 1 });
      expect(board.seated[0].assigned_table).toEqual({ id: table.id, label: 'B1' });

      await onBoard(request(http).post(`/api/v1/queue-tokens/${t2.body.id}/call`)).send();
      await onBoard(request(http).post(`/api/v1/queue-tokens/${t2.body.id}/no-show`)).send();
      await onBoard(request(http).post(`/api/v1/queue-tokens/${t3.body.id}/cancel`)).send();
      board = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(board.counts).toMatchObject({ waiting: 0, called: 0, seated: 1, no_show: 1, cancelled: 1 });
      expect(board.next_waiting).toBeNull();
    });

    it('QB-3. orders called parties longest-waiting first', async () => {
      const branch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Order Branch', timezone: 'UTC', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({
        data: { user_id: podiumA.id, branch_id: branch.id, role_id: role!.id },
      });
      const on = (req: request.Test) => as(req, tokenPodiumA, companyA.id, branch.id);

      const a = await register({ adults: 2 }, branch.id);
      const b = await register({ adults: 2 }, branch.id);
      // Call the SECOND token first: order must follow called_at, not number.
      await on(request(http).post(`/api/v1/queue-tokens/${b.body.id}/call`)).send();
      await new Promise((r) => setTimeout(r, 10));
      await on(request(http).post(`/api/v1/queue-tokens/${a.body.id}/call`)).send();

      const board = (await on(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(board.called.map((t: any) => t.id)).toEqual([b.body.id, a.body.id]);
    });

    it('QB-4. shows the customer name to staff who hold queue.view', async () => {
      const t = await register({ adults: 2, customer_id: customerA.id }, boardBranch.id);
      expect(t.status).toBe(201);
      const board = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      const entry = board.waiting.find((x: any) => x.id === t.body.id);
      expect(entry.customer).toEqual({ id: customerA.id, name: 'Asha Rao' });
      await onBoard(request(http).post(`/api/v1/queue-tokens/${t.body.id}/cancel`)).send();
    });

    it('QB-5. is branch-scoped and permission-gated', async () => {
      const mine = (await onBoard(request(http).get('/api/v1/queue-tokens/board'))).body;
      expect(mine.branch_id).toBe(boardBranch.id);

      const stranger = await as(
        request(http).get('/api/v1/queue-tokens/board'),
        tokenStrangerA,
        companyA.id,
        branchA.id,
      );
      expect(stranger.status).toBe(403);

      const crossCompany = await as(
        request(http).get('/api/v1/queue-tokens/board'),
        tokenPodiumB,
        companyA.id,
        boardBranch.id,
      );
      expect(crossCompany.status).toBe(403);
    });

    it('QB-6. accepts an explicit service date and validates it', async () => {
      const past = await onBoard(request(http).get('/api/v1/queue-tokens/board')).query({
        service_date: '2020-01-01',
      });
      expect(past.status).toBe(200);
      expect(past.body.counts).toEqual({ scheduled: 0, waiting: 0, called: 0, seated: 0, no_show: 0, cancelled: 0 });
      // A day nobody registered on has no counter row: its next number is 1.
      expect(past.body.next_token_number).toBe(1);

      const bad = await onBoard(request(http).get('/api/v1/queue-tokens/board')).query({
        service_date: '2026-02-30',
      });
      expect(bad.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPLAY DEVICES  (customer display + admin display read models)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Display boards', () => {
    let dBranch: any;
    let customerDevice: string, adminDevice: string, chefDevice: string, revokedDevice: string;
    let otherBranchDevice: string, offBranchDevice: string, suspendedDevice: string;
    let seededToken: any, calledToken: any;

    const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

    /** Pair a device directly and return its `<id>.<secret>` credential. */
    const pair = async (branchId: string, kind: DisplayDeviceKind, status = DisplayDeviceStatus.ACTIVE) => {
      const secret = crypto.randomBytes(32).toString('hex');
      const device = await prisma.displayDevice.create({
        data: {
          branch_id: branchId,
          name: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
          kind,
          credential_hash: sha256(secret),
          status,
          revoked_at: status === DisplayDeviceStatus.REVOKED ? new Date() : null,
        },
      });
      return `${device.id}.${secret}`;
    };

    const asDevice = (req: request.Test, credential: string, branchId: string) =>
      req.set('Authorization', `Display ${credential}`).set('X-Branch-ID', branchId);

    beforeAll(async () => {
      dBranch = await prisma.branch.create({
        data: { company_id: companyA.id, name: 'Display Branch', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
      });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Podium' } });
      await prisma.userBranchRole.create({
        data: { user_id: podiumA.id, branch_id: dBranch.id, role_id: role!.id },
      });
      const table = await prisma.table.create({
        data: { branch_id: dBranch.id, label: 'D1', capacity: 4 },
      });
      const on = (req: request.Test) => as(req, tokenPodiumA, companyA.id, dBranch.id);

      // A named customer, so the projections can be checked for PII leakage.
      seededToken = (await register({ adults: 2, customer_id: customerA.id }, dBranch.id)).body;
      await on(request(http).post(`/api/v1/queue-tokens/${seededToken.id}/call`)).send();
      await on(request(http).post(`/api/v1/queue-tokens/${seededToken.id}/seat`)).send({ table_id: table.id });

      calledToken = (await register({ adults: 5 }, dBranch.id)).body;
      await on(request(http).post(`/api/v1/queue-tokens/${calledToken.id}/call`)).send();
      await register({ adults: 3 }, dBranch.id); // one still waiting

      customerDevice = await pair(dBranch.id, DisplayDeviceKind.QUEUE_CUSTOMER);
      adminDevice = await pair(dBranch.id, DisplayDeviceKind.QUEUE_ADMIN);
      chefDevice = await pair(dBranch.id, DisplayDeviceKind.BANQUET_CHEF);
      revokedDevice = await pair(dBranch.id, DisplayDeviceKind.QUEUE_CUSTOMER, DisplayDeviceStatus.REVOKED);
      otherBranchDevice = await pair(branchA.id, DisplayDeviceKind.QUEUE_CUSTOMER);
      offBranchDevice = await pair(branchOff.id, DisplayDeviceKind.QUEUE_CUSTOMER);
      suspendedDevice = await pair(branchS.id, DisplayDeviceKind.QUEUE_CUSTOMER);
    });

    it('QD-1. customer display: token numbers and tables only, no identity at all', async () => {
      const res = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        customerDevice,
        dBranch.id,
      );
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['branch_id', 'now_serving', 'recently_seated', 'service_date', 'waiting_count', 'waiting_tokens'].sort(),
      );
      // The waiting tiles are bare numbers.
      expect(res.body.waiting_tokens).toHaveLength(1);
      expect(res.body.waiting_tokens.every((n: unknown) => typeof n === 'number')).toBe(true);
      expect(res.body.now_serving).toEqual([
        { token_number: calledToken.token_number, table_label: null, called_at: expect.any(String) },
      ]);
      expect(res.body.recently_seated[0]).toMatchObject({
        token_number: seededToken.token_number,
        table_label: 'D1',
      });
      expect(res.body.waiting_count).toBe(1);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain('Asha Rao');
      expect(json).not.toContain(customerA.id);
      expect(json).not.toMatch(/party_size|customer|password|credential|secret|hash|Bearer/i);
    });

    it('QD-2. admin display: the operational picture, still without customer names', async () => {
      const res = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        adminDevice,
        dBranch.id,
      );
      expect(res.status).toBe(200);
      expect(res.body.counts).toMatchObject({ waiting: 1, called: 1, seated: 1 });
      // Total Waiting / Adults / Kids: the one party still waiting is 3 adults.
      expect(res.body.totals).toEqual({ parties: 1, adults: 3, kids: 0 });
      expect(res.body.called[0]).toMatchObject({
        id: calledToken.id,
        token_number: calledToken.token_number,
        party_size: 5,
        adults: 5,
        kids: 0,
        status: 'CALLED',
      });
      expect(res.body.seated[0].assigned_table).toEqual({
        id: res.body.seated[0].assigned_table_id,
        label: 'D1',
      });
      for (const t of [...res.body.waiting, ...res.body.called, ...res.body.seated]) {
        expect(t).not.toHaveProperty('customer');
      }
      expect(JSON.stringify(res.body)).not.toContain('Asha Rao');
    });

    it('QD-3. a chef board cannot read a queue board', async () => {
      const res = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        chefDevice,
        dBranch.id,
      );
      expect(res.status).toBe(403);
    });

    it('QD-4. a revoked device is refused', async () => {
      const res = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        revokedDevice,
        dBranch.id,
      );
      expect(res.status).toBe(401);
    });

    it('QD-5. a device cannot read another branch\'s board', async () => {
      // Its own credential, but pointed at a branch it does not belong to.
      const res = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        otherBranchDevice,
        dBranch.id,
      );
      expect(res.status).toBe(401);

      // ...and the reverse direction is equally refused.
      const reverse = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        customerDevice,
        branchA.id,
      );
      expect(reverse.status).toBe(401);
    });

    it('QD-6. an inactive branch and a suspended company are refused', async () => {
      const off = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        offBranchDevice,
        branchOff.id,
      );
      expect(off.status).toBe(401);

      const suspended = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        suspendedDevice,
        branchS.id,
      );
      expect(suspended.status).toBe(401);
    });

    it('QD-7. a tampered or malformed credential is refused', async () => {
      const [id] = customerDevice.split('.');
      for (const cred of [
        `${id}.${'0'.repeat(64)}`, // wrong secret
        `${crypto.randomUUID()}.${customerDevice.split('.')[1]}`, // right secret, wrong device
        id, // no secret
        'not-a-uuid.secret',
      ]) {
        const res = await asDevice(request(http).get('/api/v1/display/queue/board'), cred, dBranch.id);
        expect([cred.slice(0, 12), res.status]).toEqual([cred.slice(0, 12), 401]);
      }
    });

    it('QD-8. a staff JWT cannot act as a display, and a display cannot act as staff', async () => {
      const jwtOnDisplay = await request(http)
        .get('/api/v1/display/queue/board')
        .set('Authorization', `Bearer ${tokenPodiumA}`)
        .set('X-Branch-ID', dBranch.id);
      expect(jwtOnDisplay.status).toBe(401);

      const deviceOnStaff = await request(http)
        .get('/api/v1/queue-tokens/board')
        .set('Authorization', `Display ${customerDevice}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', dBranch.id);
      expect(deviceOnStaff.status).toBe(401);

      // A device certainly cannot mutate the queue.
      const deviceMutation = await request(http)
        .post('/api/v1/queue-tokens')
        .set('Authorization', `Display ${customerDevice}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', dBranch.id)
        .send({ adults: 2 });
      expect(deviceMutation.status).toBe(401);
    });

    it('QD-9. a display mints a single-use queue stream ticket with its header credential', async () => {
      const res = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        customerDevice,
        dBranch.id,
      ).send({ channel: 'queue' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ channel: 'queue', branch_id: dBranch.id });
      expect(res.body.ticket).toMatch(/^[0-9a-f]{64}$/);
      // The long-lived credential is never echoed back.
      expect(JSON.stringify(res.body)).not.toContain(customerDevice.split('.')[1]);

      // Single use: the stream accepts it once.
      const first = await request(http)
        .get('/api/v1/realtime/stream')
        .query({ ticket: res.body.ticket })
        .set('Accept', 'text/event-stream')
        .timeout({ deadline: 300 })
        .catch((e: any) => e);
      expect(first.status ?? 200).not.toBe(401);

      const reused = await request(http)
        .get('/api/v1/realtime/stream')
        .query({ ticket: res.body.ticket });
      expect(reused.status).toBe(401);
    });

    it('QD-10. a queue display cannot mint a ticket for another channel', async () => {
      const res = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        customerDevice,
        dBranch.id,
      ).send({ channel: 'banquet-kds' });
      expect(res.status).toBe(403);

      const chef = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        chefDevice,
        dBranch.id,
      ).send({ channel: 'queue' });
      expect(chef.status).toBe(403);

      // `tasks` is a real channel, but no display kind may reach it at all.
      const tasks = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        customerDevice,
        dBranch.id,
      ).send({ channel: 'tasks' });
      expect(tasks.status).toBe(403);

      // A channel that does not exist fails validation before anything else.
      const bogus = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        customerDevice,
        dBranch.id,
      ).send({ channel: 'not-a-channel' });
      expect(bogus.status).toBe(400);
    });

    it('QD-11. a revoked device cannot mint a ticket', async () => {
      const res = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        revokedDevice,
        dBranch.id,
      ).send({ channel: 'queue' });
      expect(res.status).toBe(401);
    });

    it('QD-12. the board reflects queue mutations made by staff', async () => {
      const before = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        customerDevice,
        dBranch.id,
      );
      const waitingBefore = before.body.waiting_count;

      await register({ adults: 2 }, dBranch.id);

      const after = await asDevice(
        request(http).get('/api/v1/display/queue/board'),
        customerDevice,
        dBranch.id,
      );
      expect(after.body.waiting_count).toBe(waitingBefore + 1);
    });
  });

});

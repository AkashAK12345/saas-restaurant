/**
 * Phase 10 — Reports & Dashboard.
 *
 * Fixture:
 *   companyA ─ branchA  (Asia/Kolkata) ─ analystA   (all report + domain perms)
 *            │                         ├ queueOnlyA (reports/dashboard + queue only)
 *            │                         ├ noExportA  (reports.view, no export)
 *            │                         └ plainA     (queue.view, no reports.view)
 *            └ branchA2 (UTC)          ─ analystA   (same role, second branch)
 *   companyB ─ branchB  (UTC)          ─ analystB
 *
 * The point of the fixture is that every isolation claim has something real to
 * leak: branchA2 and companyB both hold data of every kind.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import {
  BanquetBookingStatus,
  BranchStatus,
  CompanyStatus,
  MembershipStatus,
  QueueTokenStatus,
  TaskStatus,
} from '@samco/database';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded, purgeAuditLogs } from './utils/db.js';
import { ReportRegistry } from '../src/modules/reports/report-registry.service.js';
import { DashboardService } from '../src/modules/reports/dashboard.service.js';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const ANALYST_PERMS = [
  'reports.view',
  'reports.export',
  'dashboard.view',
  'queue.view',
  'banquet.view',
  'tasks.view',
  'tasks.reports.view',
  'pos.reports.view',
  'purchase.reports.view',
  'inventory.view',
  'inventory.purchase.create',
  'inventory.suppliers.manage',
  'inventory.transfer',
];
const QUEUE_ONLY_PERMS = ['reports.view', 'reports.export', 'dashboard.view', 'queue.view'];
const NO_EXPORT_PERMS = ['reports.view', 'dashboard.view', 'queue.view'];
const PLAIN_PERMS = ['queue.view'];

/** 2026-03-10 in Kolkata starts at 18:30 UTC on 2026-03-09. */
const KOLKATA_DAY = '2026-03-10';
/** One minute BEFORE that local day begins — the boundary case. */
const JUST_BEFORE_KOLKATA_DAY = new Date('2026-03-09T18:29:00.000Z');

describe('Phase 10 Reports & Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let companyA: any, companyB: any;
  let branchA: any, branchA2: any, branchB: any;
  let analystA: any, queueOnlyA: any, noExportA: any, plainA: any, analystB: any;
  let tokenAnalystA: string,
    tokenQueueOnlyA: string,
    tokenNoExportA: string,
    tokenPlainA: string,
    tokenAnalystB: string;
  let bookingA: any;

  const as = (req: request.Test, token: string, companyId: string, branchId?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    if (branchId) req.set('X-Branch-ID', branchId);
    return req;
  };
  const asAnalyst = (req: request.Test, branchId = branchA.id) =>
    as(req, tokenAnalystA, companyA.id, branchId);

  /** Queue tokens are keyed by branch-local service_date, not by instant. */
  const seedToken = (
    branchId: string,
    companyId: string,
    n: number,
    status: QueueTokenStatus,
    createdAt: Date,
    seatedAt: Date | null,
    serviceDate = KOLKATA_DAY,
  ) =>
    prisma.queueToken.create({
      data: {
        company_id: companyId,
        branch_id: branchId,
        service_date: new Date(`${serviceDate}T00:00:00.000Z`),
        token_number: n,
        status,
        adults: 2,
        party_size: 2,
        created_at: createdAt,
        seated_at: seatedAt,
      },
    });

  const seedTask = (
    branchId: string,
    companyId: string,
    title: string,
    status: TaskStatus,
    createdAt: Date,
    completedAt: Date | null = null,
    assigneeId: string | null = null,
  ) =>
    prisma.task.create({
      data: {
        company_id: companyId,
        branch_id: branchId,
        title,
        status,
        created_at: createdAt,
        completed_at: completedAt,
        assignee_id: assigneeId,
      },
    });

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
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const hash = await bcrypt.hash(PASSWORD, SALT);

    companyA = await prisma.company.create({
      data: { name: 'Reports Alpha', status: CompanyStatus.ACTIVE },
    });
    companyB = await prisma.company.create({
      data: { name: 'Reports Beta', status: CompanyStatus.ACTIVE },
    });

    branchA = await prisma.branch.create({
      data: {
        company_id: companyA.id,
        name: 'Alpha Main',
        timezone: 'Asia/Kolkata',
        status: BranchStatus.ACTIVE,
      },
    });
    branchA2 = await prisma.branch.create({
      data: {
        company_id: companyA.id,
        name: 'Alpha Second',
        timezone: 'UTC',
        status: BranchStatus.ACTIVE,
      },
    });
    branchB = await prisma.branch.create({
      data: {
        company_id: companyB.id,
        name: 'Beta Main',
        timezone: 'UTC',
        status: BranchStatus.ACTIVE,
      },
    });

    const allPerms = [...new Set([...ANALYST_PERMS, ...QUEUE_ONLY_PERMS, ...PLAIN_PERMS])];
    const perms = await prisma.permission.findMany({ where: { name: { in: allPerms } } });
    expect(perms).toHaveLength(allPerms.length); // seed sanity: Phase 10 keys exist
    const byName = new Map(perms.map((p) => [p.name, p.id]));

    const analystRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Analyst' },
    });
    const queueRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Queue Analyst' },
    });
    const noExportRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Read Only Analyst' },
    });
    const plainRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Floor Staff' },
    });
    const analystRoleB = await prisma.role.create({
      data: { company_id: companyB.id, name: 'Analyst' },
    });

    await prisma.rolePermission.createMany({
      data: [
        ...ANALYST_PERMS.map((n) => ({ role_id: analystRoleA.id, permission_id: byName.get(n)! })),
        ...QUEUE_ONLY_PERMS.map((n) => ({ role_id: queueRoleA.id, permission_id: byName.get(n)! })),
        ...NO_EXPORT_PERMS.map((n) => ({
          role_id: noExportRoleA.id,
          permission_id: byName.get(n)!,
        })),
        ...PLAIN_PERMS.map((n) => ({ role_id: plainRoleA.id, permission_id: byName.get(n)! })),
        ...ANALYST_PERMS.map((n) => ({ role_id: analystRoleB.id, permission_id: byName.get(n)! })),
      ],
    });

    analystA = await prisma.user.create({
      data: {
        email: 'r-analyst-a@test.com',
        password_hash: hash,
        first_name: 'Ana',
        last_name: 'Lyst',
      },
    });
    queueOnlyA = await prisma.user.create({
      data: {
        email: 'r-queue-a@test.com',
        password_hash: hash,
        first_name: 'Quinn',
        last_name: 'Queue',
      },
    });
    noExportA = await prisma.user.create({
      data: { email: 'r-noexport-a@test.com', password_hash: hash },
    });
    plainA = await prisma.user.create({ data: { email: 'r-plain-a@test.com', password_hash: hash } });
    analystB = await prisma.user.create({
      data: { email: 'r-analyst-b@test.com', password_hash: hash },
    });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: analystA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: queueOnlyA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: noExportA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: plainA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: analystB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: analystA.id, branch_id: branchA.id, role_id: analystRoleA.id },
        { user_id: analystA.id, branch_id: branchA2.id, role_id: analystRoleA.id },
        { user_id: queueOnlyA.id, branch_id: branchA.id, role_id: queueRoleA.id },
        { user_id: noExportA.id, branch_id: branchA.id, role_id: noExportRoleA.id },
        { user_id: plainA.id, branch_id: branchA.id, role_id: plainRoleA.id },
        { user_id: analystB.id, branch_id: branchB.id, role_id: analystRoleB.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body
        .accessToken as string;
    tokenAnalystA = await login('r-analyst-a@test.com');
    tokenQueueOnlyA = await login('r-queue-a@test.com');
    tokenNoExportA = await login('r-noexport-a@test.com');
    tokenPlainA = await login('r-plain-a@test.com');
    tokenAnalystB = await login('r-analyst-b@test.com');

    // ── Queue data ──────────────────────────────────────────────────────────
    // branchA, the Kolkata day under test: 3 tokens, one seated after 30min.
    await seedToken(
      branchA.id,
      companyA.id,
      1,
      QueueTokenStatus.SEATED,
      new Date('2026-03-10T04:00:00.000Z'),
      new Date('2026-03-10T04:30:00.000Z'),
    );
    await seedToken(
      branchA.id,
      companyA.id,
      2,
      QueueTokenStatus.NO_SHOW,
      new Date('2026-03-10T05:00:00.000Z'),
      null,
    );
    // Registered one minute before the local day began; it belongs to the
    // PREVIOUS service date and must not appear in the KOLKATA_DAY report.
    await seedToken(
      branchA.id,
      companyA.id,
      1,
      QueueTokenStatus.CANCELLED,
      JUST_BEFORE_KOLKATA_DAY,
      null,
      '2026-03-09',
    );
    // Same day, OTHER branch of the same company — the branch-isolation bait.
    await seedToken(
      branchA2.id,
      companyA.id,
      1,
      QueueTokenStatus.SEATED,
      new Date('2026-03-10T04:00:00.000Z'),
      new Date('2026-03-10T04:10:00.000Z'),
    );
    // Same day, OTHER company — the tenant-isolation bait.
    await seedToken(
      branchB.id,
      companyB.id,
      1,
      QueueTokenStatus.SEATED,
      new Date('2026-03-10T04:00:00.000Z'),
      new Date('2026-03-10T04:05:00.000Z'),
    );

    // ── Banquet data ────────────────────────────────────────────────────────
    const hallA = await prisma.banquetHall.create({
      data: { branch_id: branchA.id, name: 'Grand Hall', capacity: 200 },
    });
    const customerA = await prisma.customer.create({
      data: { company_id: companyA.id, name: 'Priya Sharma', phone: '+919000000001' },
    });
    bookingA = await prisma.banquetBooking.create({
      data: {
        company_id: companyA.id,
        branch_id: branchA.id,
        customer_id: customerA.id,
        hall_id: hallA.id,
        starts_at: new Date('2026-03-10T06:00:00.000Z'),
        ends_at: new Date('2026-03-10T12:00:00.000Z'),
        guest_count: 100,
        status: BanquetBookingStatus.CONFIRMED,
        package_name: 'Gold',
        price_per_guest_minor: 150_000,
        currency: 'INR',
        total_amount_minor: 15_000_000,
      },
    });
    await prisma.banquetPayment.create({
      data: {
        booking_id: bookingA.id,
        company_id: companyA.id,
        branch_id: branchA.id,
        amount_minor: 5_000_000,
        currency: 'INR',
        paid_at: new Date('2026-03-10T07:00:00.000Z'),
        method: 'cash',
      },
    });

    // ── Task data ───────────────────────────────────────────────────────────
    await seedTask(
      branchA.id,
      companyA.id,
      'Clean the fryer',
      TaskStatus.COMPLETED,
      new Date('2026-03-10T04:00:00.000Z'),
      new Date('2026-03-10T05:00:00.000Z'),
      analystA.id,
    );
    await seedTask(
      branchA.id,
      companyA.id,
      'Restock napkins',
      TaskStatus.PENDING,
      new Date('2026-03-10T04:30:00.000Z'),
    );
    await seedTask(
      branchA2.id,
      companyA.id,
      'Other branch task',
      TaskStatus.COMPLETED,
      new Date('2026-03-10T04:00:00.000Z'),
      new Date('2026-03-10T04:30:00.000Z'),
    );
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  const range = { from: KOLKATA_DAY, to: KOLKATA_DAY };
  const data = (key: string, query: Record<string, unknown> = {}, branchId = branchA.id) =>
    asAnalyst(request(http).get(`/api/v1/reports/${key}/data`), branchId).query({
      ...range,
      ...query,
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION & AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('RP-1. rejects an unauthenticated request to every reporting route', async () => {
      for (const path of [
        '/api/v1/reports',
        '/api/v1/reports/queue.summary',
        '/api/v1/reports/queue.summary/data',
        '/api/v1/reports/queue.summary/export?format=xlsx',
        '/api/v1/dashboard',
      ]) {
        expect((await request(http).get(path)).status).toBe(401);
      }
    });

    it('RP-2. rejects a caller who holds domain permissions but not reports.view', async () => {
      const res = await as(
        request(http).get('/api/v1/reports'),
        tokenPlainA,
        companyA.id,
        branchA.id,
      );
      expect(res.status).toBe(403);
    });

    it('RP-3. rejects dashboard access without dashboard.view', async () => {
      const res = await as(
        request(http).get('/api/v1/dashboard'),
        tokenPlainA,
        companyA.id,
        branchA.id,
      );
      expect(res.status).toBe(403);
    });

    // The whole point of the second key: reports.view must not be a back door
    // into a domain the caller cannot otherwise see.
    it('RP-4. reports.view alone does not reveal a domain the caller lacks', async () => {
      const res = await as(
        request(http).get('/api/v1/reports'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      );
      expect(res.status).toBe(200);

      const keys = res.body.data.map((d: any) => d.key);
      expect(keys).toContain('queue.summary');
      expect(keys).toContain('queue.tokens');
      expect(keys).not.toContain('banquet.bookings');
      expect(keys).not.toContain('banquet.payments');
      expect(keys.some((k: string) => k.startsWith('tasks.'))).toBe(false);
    });

    it('RP-5. refuses to RUN a report whose domain permission is missing', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/banquet.bookings/data'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      ).query(range);
      expect(res.status).toBe(403);
      // The refusal names the domain, never the data.
      expect(JSON.stringify(res.body)).not.toContain('Priya');
    });

    it('RP-6. refuses to DESCRIBE a report whose domain permission is missing', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/banquet.bookings'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      );
      expect(res.status).toBe(403);
    });

    it('RP-7. lists every report to a caller who holds all the domain keys', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports'));
      expect(res.status).toBe(200);

      const keys = res.body.data.map((d: any) => d.key);
      expect(keys).toEqual([
        'banquet.bookings',
        'banquet.outstanding',
        'banquet.payments',
        'pos.analytics',
        'pos.orders',
        'pos.revenue_by_hour',
        'pos.revenue_by_type',
        'pos.summary',
        'purchase.by_item',
        'purchase.by_vendor',
        'queue.summary',
        'queue.tokens',
        'tasks.assignee',
        'tasks.banquet_opening',
        'tasks.banquet_opening_compliance',
        'tasks.biryani_sales',
        'tasks.biryani_sales_compliance',
        'tasks.bm',
        'tasks.bm_compliance',
        'tasks.completion',
        'tasks.eod',
        'tasks.eod_compliance',
        'tasks.kitchen',
        'tasks.kitchen_balance',
        'tasks.kitchen_balance_compliance',
        'tasks.kitchen_compliance',
        'tasks.log',
        'tasks.opening',
        'tasks.opening_compliance',
        'tasks.operational',
        'tasks.operational_compliance',
        'tasks.routines',
        'tasks.stock_requests',
        'tasks.stock_requests_compliance',
      ]);
      expect(res.body.meta.total).toBe(keys.length);
    });

    it('RP-8. 404s an unknown report key rather than confirming what exists', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/pos.sales'));
      expect(res.status).toBe(404);

      const dataRes = await asAnalyst(
        request(http).get('/api/v1/reports/pos.sales/data'),
      ).query(range);
      expect(dataRes.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TENANT & BRANCH ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('RP-9. a header naming another company’s branch is refused, not honoured', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/queue.summary/data'),
        tokenAnalystA,
        companyA.id,
        branchB.id,
      ).query(range);
      // Branch does not belong to the caller's company: not found, not "denied".
      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    it('RP-10. company B’s analyst cannot read company A’s branch', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/queue.summary/data'),
        tokenAnalystB,
        companyB.id,
        branchA.id,
      ).query(range);
      expect(res.status).not.toBe(200);
    });

    it('RP-11. claiming another company in the header does not move the data', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/queue.summary/data'),
        tokenAnalystB,
        companyA.id,
        branchA.id,
      ).query(range);
      expect(res.status).not.toBe(200);
    });

    it('RP-12. a branch report counts only that branch', async () => {
      const res = await data('queue.summary');
      expect(res.status).toBe(200);

      const registered = res.body.metrics.find((m: any) => m.key === 'registered');
      // 2 at branchA on this local day. branchA2 and branchB each have one too.
      expect(registered.value).toBe(2);
    });

    it('RP-13. the same report at the sibling branch returns that branch’s own data', async () => {
      const res = await data('queue.summary', {}, branchA2.id);
      expect(res.status).toBe(200);
      expect(res.body.filters.branch_id).toBe(branchA2.id);
      expect(res.body.metrics.find((m: any) => m.key === 'registered').value).toBe(1);
    });

    it('RP-14. task reports are branch-scoped too', async () => {
      const res = await data('tasks.completion');
      expect(res.status).toBe(200);
      expect(res.body.metrics.find((m: any) => m.key === 'created').value).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DATES, FILTERS, PAGINATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Date ranges', () => {
    it('RP-15. resolves the range in the BRANCH timezone, not the server’s', async () => {
      const res = await data('queue.summary');
      expect(res.body.timezone).toBe('Asia/Kolkata');
      expect(res.body.filters).toMatchObject({ from: KOLKATA_DAY, to: KOLKATA_DAY });

      // The token registered at 18:29 UTC belongs to the previous Kolkata day
      // and must be absent; the 18:30 boundary is where the day starts.
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].service_date).toBe(KOLKATA_DAY);
      expect(res.body.rows[0].registered).toBe(2);
    });

    it('RP-16. includes the previous local day when the range is widened', async () => {
      const res = await data('queue.summary', { from: '2026-03-09' });
      expect(res.body.rows.map((r: any) => r.service_date)).toEqual(['2026-03-10', '2026-03-09']);
    });

    it('RP-17. groups task activity by the branch-local day it was raised', async () => {
      const res = await data('tasks.completion');
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]).toMatchObject({ day: KOLKATA_DAY, created: 2, completed: 1 });
    });

    it('RP-18. rejects a malformed date', async () => {
      for (const bad of ['10-03-2026', '2026-3-1', 'yesterday', '2026-03-10T00:00:00Z']) {
        const res = await asAnalyst(request(http).get('/api/v1/reports/queue.summary/data')).query({
          from: bad,
          to: KOLKATA_DAY,
        });
        expect(res.status).toBe(400);
      }
    });

    it('RP-19. rejects an impossible calendar date and a reversed range', async () => {
      expect(
        (
          await asAnalyst(request(http).get('/api/v1/reports/queue.summary/data')).query({
            from: '2026-02-30',
            to: '2026-03-01',
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await asAnalyst(request(http).get('/api/v1/reports/queue.summary/data')).query({
            from: '2026-03-31',
            to: '2026-03-01',
          })
        ).status,
      ).toBe(400);
    });

    it('RP-20. rejects a range wider than the cap instead of scanning years', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/queue.summary/data')).query({
        from: '2020-01-01',
        to: '2026-12-31',
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/366|range/i);
    });

    it('RP-21. defaults to a bounded recent window when no dates are given', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/queue.summary/data'));
      expect(res.status).toBe(200);
      expect(res.body.filters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.filters.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Filters and pagination', () => {
    it('RP-22. applies a declared filter', async () => {
      const res = await data('queue.tokens', { status: 'SEATED' });
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].status).toBe('SEATED');
      expect(res.body.filters.options).toEqual({ status: 'SEATED' });
    });

    it('RP-23. rejects a value outside the declared allow-list', async () => {
      const res = await data('queue.tokens', { status: 'DEFINITELY_NOT_A_STATUS' });
      expect(res.status).toBe(400);
    });

    it('RP-24. a filter value cannot reach SQL', async () => {
      const res = await data('queue.tokens', { status: "SEATED'; DROP TABLE queue_tokens; --" });
      expect(res.status).toBe(400);
      // The table is still there and still readable.
      expect((await data('queue.tokens')).status).toBe(200);
    });

    it('RP-25. rejects a filter the report never declared', async () => {
      const res = await data('queue.summary', { status: 'SEATED' });
      expect(res.status).toBe(400);
    });

    it('RP-26. rejects an undeclared query parameter outright', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/queue.tokens/data')).query({
        ...range,
        company_id: companyB.id,
      });
      expect(res.status).toBe(400);
    });

    it('RP-27. paginates row reports and reports the true total', async () => {
      const first = await data('queue.tokens', { limit: 1, offset: 0 });
      expect(first.status).toBe(200);
      expect(first.body.rows).toHaveLength(1);
      expect(first.body.meta).toEqual({ total: 2, limit: 1, offset: 0 });

      const second = await data('queue.tokens', { limit: 1, offset: 1 });
      expect(second.body.rows).toHaveLength(1);
      expect(second.body.rows[0].token_number).not.toBe(first.body.rows[0].token_number);

      const past = await data('queue.tokens', { limit: 1, offset: 50 });
      expect(past.body.rows).toHaveLength(0);
      expect(past.body.meta.total).toBe(2);
    });

    it('RP-28. rejects an unbounded page size', async () => {
      expect((await data('queue.tokens', { limit: 100000 })).status).toBe(400);
      expect((await data('queue.tokens', { limit: 0 })).status).toBe(400);
      expect((await data('queue.tokens', { offset: -1 })).status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT CONTENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Report content', () => {
    it('RP-29. queue summary computes outcomes and the average wait', async () => {
      const res = await data('queue.summary');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;

      expect(metric('registered')).toBe(2);
      expect(metric('seated')).toBe(1);
      expect(metric('no_show')).toBe(1);
      expect(metric('seated_rate')).toBe(50);
      expect(metric('avg_wait_seconds')).toBe(1800); // the one 30-minute wait
    });

    it('RP-30. banquet money stays in integer minor units', async () => {
      const res = await data('banquet.bookings');
      expect(res.status).toBe(200);

      const row = res.body.rows[0];
      expect(row.total_amount_minor).toBe(15_000_000);
      expect(row.paid_amount_minor).toBe(5_000_000);
      expect(row.balance_minor).toBe(10_000_000);
      // Never a fraction anywhere in the payload.
      expect(Number.isInteger(row.total_amount_minor)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('150000.00');

      const balance = res.body.metrics.find((m: any) => m.key === 'balance_INR');
      expect(balance).toMatchObject({ value: 10_000_000, type: 'money', currency: 'INR' });
    });

    it('RP-31. banquet payments report the period’s receipts', async () => {
      const res = await data('banquet.payments');
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]).toMatchObject({ amount_minor: 5_000_000, method: 'cash' });
      expect(res.body.metrics.find((m: any) => m.key === 'collected_INR').value).toBe(5_000_000);
    });

    it('RP-32. task reports attribute work and compute a completion rate', async () => {
      const byAssignee = await data('tasks.assignee');
      expect(byAssignee.status).toBe(200);

      const named = byAssignee.body.rows.find((r: any) => r.assignee_name === 'Ana Lyst');
      expect(named).toMatchObject({ assigned: 1, completed: 1, completion_rate: 100 });
      expect(byAssignee.body.rows.some((r: any) => r.assignee_name === 'Unassigned')).toBe(true);

      const completion = await data('tasks.completion');
      expect(completion.body.metrics.find((m: any) => m.key === 'completion_rate').value).toBe(50);
    });

    it('RP-33. a summary report is not silently truncated by a page size', async () => {
      const res = await data('queue.summary', { limit: 1, offset: 3, from: '2026-03-09' });
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.meta.offset).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK LOG — its own day, so the shared KOLKATA_DAY figures above (and the
  // live tasks.open tile, which counts every open task) never see these rows.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task log', () => {
    const LOG_DAY = '2026-04-15';
    const logRange = { from: LOG_DAY, to: LOG_DAY };
    const PAST = new Date('2026-04-15T06:00:00.000Z');
    const FUTURE = new Date('2099-01-01T00:00:00.000Z');
    const created: string[] = [];

    const logTask = async (
      title: string,
      status: TaskStatus,
      extra: { assignee?: string; due?: Date; branchId?: string; completedAt?: Date } = {},
    ) => {
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: extra.branchId ?? branchA.id,
          title,
          status,
          created_at: new Date('2026-04-15T05:00:00.000Z'),
          assignee_id: extra.assignee ?? null,
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
        },
      });
      created.push(task.id);
      return task;
    };

    const log = (query: Record<string, unknown> = {}) =>
      asAnalyst(request(http).get('/api/v1/reports/tasks.log/data')).query({ ...logRange, ...query });

    const titles = (res: request.Response) => res.body.rows.map((r: any) => r.title).sort();

    beforeAll(async () => {
      const done = await logTask('Log: done', TaskStatus.COMPLETED, {
        assignee: analystA.id,
        due: PAST,
        completedAt: new Date('2026-04-15T05:30:00.000Z'),
      });
      await prisma.taskChecklistItem.createMany({
        data: [
          { task_id: done.id, label: 'One', position: 0, is_done: true },
          { task_id: done.id, label: 'Two', position: 1, is_done: true },
        ],
      });
      await logTask('Log: working', TaskStatus.IN_PROGRESS, { assignee: analystA.id, due: FUTURE });
      await logTask('Log: assigned', TaskStatus.PENDING, { assignee: analystA.id, due: PAST });
      await logTask('Log: unassigned', TaskStatus.PENDING);
      await logTask('Log: cancelled', TaskStatus.CANCELLED, { due: PAST });
      await logTask('Log: other branch', TaskStatus.PENDING, { branchId: branchA2.id, due: PAST });
    });

    afterAll(async () => {
      // Checklist items restrict their task's deletion, so they go first.
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: created } } });
      await prisma.task.deleteMany({ where: { id: { in: created } } });
    });

    it('RP-TL1. lists every task raised in the window at this branch, and no other branch’s', async () => {
      const res = await log();
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Task Reports');
      expect(titles(res)).toEqual([
        'Log: assigned',
        'Log: cancelled',
        'Log: done',
        'Log: unassigned',
        'Log: working',
      ]);
      expect(res.body.meta.total).toBe(5);
    });

    it('RP-TL2. headline figures: pending is everything still open, overdue excludes cancelled work', async () => {
      const res = await log();
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_tasks')).toBe(5);
      expect(metric('completed')).toBe(1);
      expect(metric('pending')).toBe(3); // working + assigned + unassigned
      expect(metric('overdue')).toBe(1); // only "assigned": open AND past due
    });

    it('RP-TL3. each chip selects exactly its tasks', async () => {
      expect(titles(await log({ view: 'COMPLETED' }))).toEqual(['Log: done']);
      expect(titles(await log({ view: 'IN_PROGRESS' }))).toEqual(['Log: working']);
      // Assigned means handed to someone and not yet started.
      expect(titles(await log({ view: 'ASSIGNED' }))).toEqual(['Log: assigned']);
      expect(titles(await log({ view: 'INCOMPLETE' }))).toEqual([
        'Log: assigned',
        'Log: unassigned',
        'Log: working',
      ]);
      // A future due date is not late; a cancelled task is never overdue.
      expect(titles(await log({ view: 'OVERDUE' }))).toEqual(['Log: assigned']);
    });

    it('RP-TL4. the headline figures summarise the whole window, whichever chip is selected', async () => {
      const res = await log({ view: 'OVERDUE' });
      expect(res.body.meta.total).toBe(1);
      expect(res.body.metrics.find((m: any) => m.key === 'total_tasks').value).toBe(5);
    });

    it('RP-TL5. shows checklist progress, an unassigned task as such, and links each row to its task', async () => {
      const res = await log();
      const byTitle = (t: string) => res.body.rows.find((r: any) => r.title === t);
      expect(byTitle('Log: done').checklist).toBe('2/2');
      expect(byTitle('Log: unassigned').checklist).toBeNull();
      expect(byTitle('Log: unassigned').assignee_name).toBe('Unassigned');
      expect(byTitle('Log: done').assignee_name).toBe('Ana Lyst');
      expect(byTitle('Log: done').source).toBe('Manual');
      expect(res.body.drilldown).toEqual({ id_key: 'task_id', path: '/tasks/:id' });
      expect(typeof byTitle('Log: done').task_id).toBe('string');
    });

    it('RP-TL6. offers no "pending approval" filter — SAMCO tasks have no approval step', async () => {
      expect((await log({ view: 'PENDING_APPROVAL' })).status).toBe(400);
    });

    it('RP-TL7. needs tasks.reports.view, like every other task report', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/tasks.log/data'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      ).query(logRange);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EOD REPORTS — own days again, and cleaned up, for the same reason.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('EOD reports', () => {
    const eodRange = { from: '2026-05-10', to: '2026-05-13' };
    const FUTURE = new Date('2099-01-01T00:00:00.000Z');
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const eodTask = async (
      day: string,
      status: TaskStatus,
      extra: {
        branchId?: string;
        completedAt?: Date;
        due?: Date;
        answers?: Array<{ label: string; kind?: 'TEXT' | 'PHOTO'; value?: string | null }>;
      } = {},
    ) => {
      const branchId = extra.branchId ?? branchA.id;
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchId,
          name: `EOD Report ${day} ${status} ${branchId.slice(0, 4)}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchId,
          title: 'EOD Report',
          status,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
          completed_by: extra.completedAt ? analystA.id : null,
        },
      });
      taskIds.push(task.id);
      if (extra.answers) {
        await prisma.taskChecklistItem.createMany({
          data: extra.answers.map((a, position) => ({
            task_id: task.id,
            label: a.label,
            position,
            kind: a.kind ?? 'TEXT',
            value: a.value ?? null,
            is_done: a.value != null,
          })),
        });
      }
      return task;
    };

    const eod = (key: string) =>
      asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(eodRange);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'EOD Report' },
      });
      templateId = template.id;

      // Filed at 23:48 Kolkata on the 10th.
      await eodTask('2026-05-10', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-05-10T18:18:00.000Z'),
        answers: [
          { label: 'Review for the day', value: 'REVIEWS 10' },
          { label: 'Food Complaint', value: 'NIL' },
          { label: 'Food Complaint Images', kind: 'PHOTO' },
          { label: 'Service Complaints', value: 'nil' },
          { label: 'Your name', value: 'Giji' },
        ],
      });
      // The 11th's EOD, filed after midnight — still the 11th's.
      await eodTask('2026-05-11', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-05-11T18:56:00.000Z'),
        answers: [
          { label: 'Review for the day', value: '20 reviews' },
          { label: 'Food Complaint', value: 'B4 small piece of plastic found' },
          { label: 'Food Complaint Images', kind: 'PHOTO' },
          { label: 'Service Complaints', value: 'Nill' },
          { label: 'Your name', value: 'Clinton' },
        ],
      });
      // Never filed and past its deadline: missed.
      await eodTask('2026-05-12', TaskStatus.PENDING, { due: new Date('2026-05-12T18:29:00.000Z') });
      // Not filed yet, not late yet: pending.
      await eodTask('2026-05-13', TaskStatus.PENDING, { due: FUTURE });
      // Called off: expected by nobody.
      await eodTask('2026-05-13', TaskStatus.CANCELLED, { due: new Date('2026-05-13T18:29:00.000Z') });
      // Another branch's EOD must never appear.
      await eodTask('2026-05-10', TaskStatus.COMPLETED, {
        branchId: branchA2.id,
        completedAt: new Date('2026-05-10T18:00:00.000Z'),
        answers: [{ label: 'Food Complaint', value: 'Other branch complaint' }],
      });
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-EOD1. transposes the log: a column per submission, oldest first, a row per field', async () => {
      const res = await eod('tasks.eod');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('EOD Reports');
      expect(res.body.columns.map((c: any) => c.label)).toEqual(['Field', '10 May', '11 May']);
      expect(res.body.meta.total).toBe(2);

      const row = (field: string) => res.body.rows.find((r: any) => r.field === field);
      // The branch's own clock, and a late filing keeps its own day's column.
      expect(row('Submitted')).toMatchObject({ c0: '10 May, 11:48 PM', c1: '12 May, 12:26 AM' });
      expect(row('Submitted by')).toMatchObject({ c0: 'Ana Lyst', c1: 'Ana Lyst' });
      expect(row('Food Complaint')).toMatchObject({ c0: 'NIL', c1: 'B4 small piece of plastic found' });
      expect(row('Your name')).toMatchObject({ c0: 'Giji', c1: 'Clinton' });
      // A photo has no text for a grid.
      expect(row('Food Complaint Images')).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('Other branch complaint');
    });

    it('RP-EOD2. counts complaints only when something was actually reported', async () => {
      const res = await eod('tasks.eod');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(2);
      // "NIL" / "nil" / "Nill" are nothing to report.
      expect(metric('with_complaints')).toBe(1);
      expect(metric('food_complaints')).toBe(1);
      expect(metric('service_issues')).toBe(0);
    });

    it('RP-EOD3. compliance: missed is past its deadline, pending is not yet, cancelled is neither', async () => {
      const res = await eod('tasks.eod_compliance');
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([
        {
          staff: 'Ana Lyst',
          branch_name: 'Alpha Main',
          submitted: '2 of 3',
          missed: 1,
          pending: 1,
          compliance: 67,
          missed_dates: '12 May',
          filed_today: 0,
        },
      ]);
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('compliance')).toBe(67);
      expect(metric('submitted')).toBe('2 of 3');
      expect(metric('missed')).toBe(1);
      expect(metric('pending')).toBe(1);
      expect(metric('staff_count')).toBe(1);
      // The window's days that are over — all four, whoever was scheduled.
      expect(metric('due_days')).toBe(4);
    });

    it('RP-EOD4. an empty window says so rather than inventing a compliance rate', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/tasks.eod_compliance/data')).query({
        from: '2026-06-01',
        to: '2026-06-02',
      });
      expect(res.body.rows).toEqual([]);
      expect(res.body.metrics.find((m: any) => m.key === 'compliance').value).toBeNull();
      expect(res.body.metrics.find((m: any) => m.key === 'submitted').value).toBeNull();
      expect(res.body.metrics.find((m: any) => m.key === 'due_days').value).toBe(2);
    });

    it('RP-EOD5. both need tasks.reports.view', async () => {
      for (const key of ['tasks.eod', 'tasks.eod_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(eodRange);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Operational Checklist reports', () => {
    const range = { from: '2026-06-10', to: '2026-06-12' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const SECURITY = 'Overall Rating for security (scale 1-5)';
    const READINESS = 'Rate the overall Readiness of the Restaurant';
    const OPERATION = 'Rate the overall operation of the restaurant';

    const opsTask = async (
      day: string,
      status: TaskStatus,
      extra: {
        completedAt?: Date;
        due?: Date;
        answers?: Array<{
          label: string;
          kind: 'TEXT' | 'CHECK' | 'RATING' | 'PHOTO';
          value?: string | null;
          done?: boolean;
        }>;
      } = {},
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Operational Checklist ${day} ${status}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Operational Checklist',
          status,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
          completed_by: extra.completedAt ? analystA.id : null,
        },
      });
      taskIds.push(task.id);
      if (extra.answers) {
        await prisma.taskChecklistItem.createMany({
          data: extra.answers.map((a, position) => ({
            task_id: task.id,
            label: a.label,
            position,
            kind: a.kind,
            value: a.value ?? null,
            is_done: a.done ?? a.value != null,
          })),
        });
      }
      return task;
    };

    const run = (key: string, window = range) =>
      asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(window);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Operational Checklist' },
      });
      templateId = template.id;

      await opsTask('2026-06-10', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-06-10T06:30:00.000Z'),
        answers: [
          { label: 'Was security present at the entrance?', kind: 'CHECK', done: true },
          { label: SECURITY, kind: 'RATING', value: '4' },
          { label: 'Picture of the parking area', kind: 'PHOTO' },
          { label: READINESS, kind: 'RATING', value: '5' },
          { label: OPERATION, kind: 'RATING', value: '3' },
          { label: 'Remarks', kind: 'TEXT', value: 'Lift light flickering' },
        ],
      });
      await opsTask('2026-06-11', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-06-11T07:00:00.000Z'),
        answers: [
          { label: 'Was security present at the entrance?', kind: 'CHECK', done: false },
          { label: SECURITY, kind: 'RATING', value: '5' },
          { label: 'Picture of the parking area', kind: 'PHOTO' },
          // Readiness skipped: not a zero.
          { label: READINESS, kind: 'RATING', value: null },
          { label: OPERATION, kind: 'RATING', value: '4' },
          { label: 'Remarks', kind: 'TEXT', value: null },
        ],
      });
      // Never filed, past its deadline: missed.
      await opsTask('2026-06-12', TaskStatus.PENDING, { due: new Date('2026-06-12T12:00:00.000Z') });
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-OPS1. transposes the log and reads ticks and ratings as the form means them', async () => {
      const res = await run('tasks.operational');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Operational Checklist');
      expect(res.body.columns.map((c: any) => c.label)).toEqual(['Field', '10 Jun', '11 Jun']);
      expect(res.body.meta.total).toBe(2);
      const row = (field: string) => res.body.rows.find((r: any) => r.field === field);
      expect(row('Submitted')).toMatchObject({ c0: '10 Jun, 12:00 PM', c1: '11 Jun, 12:30 PM' });
      expect(row('Was security present at the entrance?')).toMatchObject({ c0: 'Yes', c1: 'No' });
      expect(row(SECURITY)).toMatchObject({ c0: '4/5', c1: '5/5' });
      expect(row('Remarks')).toMatchObject({ c0: 'Lift light flickering', c1: null });
      // A photo has no text for a grid.
      expect(row('Picture of the parking area')).toBeUndefined();
    });

    it('RP-OPS2. averages each rating over the submissions that gave it', async () => {
      const res = await run('tasks.operational');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_checklists')).toBe(2);
      expect(metric('avg_security')).toBe(4.5);
      expect(metric('avg_readiness')).toBe(5);
      expect(metric('avg_operation')).toBe(3.5);
    });

    it('RP-OPS3. an empty window reads zeros, as the reference screen does', async () => {
      const res = await run('tasks.operational', { from: '2026-07-01', to: '2026-07-02' });
      expect(res.body.meta.total).toBe(0);
      // No grid of bare field names: the screen says there is no data.
      expect(res.body.rows).toEqual([]);
      for (const key of ['total_checklists', 'avg_security', 'avg_readiness', 'avg_operation']) {
        expect(res.body.metrics.find((m: any) => m.key === key).value).toBe(0);
      }
    });

    it('RP-OPS4. compliance counts this form only, not the EOD', async () => {
      const res = await run('tasks.operational_compliance');
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([
        {
          staff: 'Ana Lyst',
          branch_name: 'Alpha Main',
          submitted: '2 of 3',
          missed: 1,
          pending: 0,
          compliance: 67,
          missed_dates: '12 Jun',
          filed_today: 0,
        },
      ]);
      expect(res.body.metrics.find((m: any) => m.key === 'due_days').value).toBe(3);
    });

    it('RP-OPS5. both need tasks.reports.view', async () => {
      for (const key of ['tasks.operational', 'tasks.operational_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Kitchen Checklist reports', () => {
    const range = { from: '2026-07-10', to: '2026-07-12' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;
    // Today on the branch's clock: a checklist filed today is not settled yet.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const HYGIENE = 'Has the kitchen been cleaned & hygiene maintained after service?';
    const FIFO = 'Is the FIFO process being followed for short-expiry items?';
    const SUPPLIES = 'Have you received the meat, vegetables, dairy products and other supplies on time?';
    const PHOTOS = 'Pictures of the Food Packing area';

    const kitchenTask = async (
      day: string,
      status: TaskStatus,
      extra: {
        completedAt?: Date;
        due?: Date;
        answers?: Array<{ label: string; value: string | null }>;
        photos?: number;
      } = {},
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Kitchen Checklist ${day} ${status} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Kitchen Checklist',
          status,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
          completed_by: extra.completedAt ? analystA.id : null,
        },
      });
      taskIds.push(task.id);
      let position = 0;
      for (const a of extra.answers ?? []) {
        await prisma.taskChecklistItem.create({
          data: { task_id: task.id, label: a.label, position: position++, kind: 'TEXT', value: a.value, is_done: a.value != null },
        });
      }
      if (extra.photos !== undefined) {
        const item = await prisma.taskChecklistItem.create({
          data: { task_id: task.id, label: PHOTOS, position: position++, kind: 'PHOTO', is_done: extra.photos > 0 },
        });
        for (let i = 0; i < extra.photos; i += 1) {
          await prisma.taskChecklistItemPhoto.create({
            data: { checklist_item_id: item.id, data: Buffer.from([0xff, 0xd8, 0xff]), mime_type: 'image/jpeg', position: i },
          });
        }
      }
      return task;
    };

    const run = (key: string, window: { from: string; to: string } = range) =>
      asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(window);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Kitchen Checklist' },
      });
      templateId = template.id;

      await kitchenTask('2026-07-10', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-07-10T06:22:00.000Z'),
        answers: [
          { label: SUPPLIES, value: 'yes' },
          { label: HYGIENE, value: 'No - drain blocked' },
          { label: FIFO, value: 'Yes' },
        ],
        photos: 3,
      });
      await kitchenTask('2026-07-11', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-07-11T06:07:00.000Z'),
        answers: [
          { label: SUPPLIES, value: 'Yes' },
          { label: HYGIENE, value: 'N/A' },
          { label: FIFO, value: 'N/A' },
        ],
        photos: 0,
      });
      // Never filed, past its deadline: missed.
      await kitchenTask('2026-07-12', TaskStatus.PENDING, { due: new Date('2026-07-12T12:00:00.000Z') });
      // Filed today, and another of today's still open, even past its deadline.
      await kitchenTask(today, TaskStatus.COMPLETED, { completedAt: new Date(), photos: 1 });
      await kitchenTask(today, TaskStatus.PENDING, { due: new Date(Date.now() - 60_000) });
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-KIT1. one row per submission, newest first, with its answers and photo count', async () => {
      const res = await run('tasks.kitchen');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Kitchen Checklist');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted By',
        'Submitted At',
        'Branch',
        'Meat/Veg/Dairy',
        'Equipment',
        'Depts Ready',
        'Hygiene',
        'FIFO',
        'Images',
      ]);
      expect(res.body.drilldown).toEqual({ id_key: 'task_id', path: '/tasks/:id' });
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0]).toMatchObject({
        date: '11 Jul',
        submitted_by: 'Ana Lyst',
        submitted_at: '11 Jul, 11:37 AM',
        branch_name: 'Alpha Main',
        meat_veg_dairy: 'Yes',
        equipment: null,
        hygiene: 'N/A',
        fifo: 'N/A',
        images: '0 imgs',
      });
      expect(res.body.rows[1]).toMatchObject({ date: '10 Jul', hygiene: 'No - drain blocked', images: '3 imgs' });
      expect(taskIds).toContain(res.body.rows[0].task_id);
    });

    it('RP-KIT2. the cards: photos attached, a "no" on hygiene, a "yes" on FIFO', async () => {
      const res = await run('tasks.kitchen');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_checklists')).toBe(2);
      expect(metric('with_images')).toBe(1);
      expect(metric('hygiene_issues')).toBe(1);
      // "N/A" is neither followed nor an issue.
      expect(metric('fifo_followed')).toBe(1);
    });

    it("RP-KIT3. compliance settles past days only: today's filing shows as \"Pending (1 filed)\"", async () => {
      const res = await run('tasks.kitchen_compliance', { from: range.from, to: today });
      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([
        {
          staff: 'Ana Lyst',
          branch_name: 'Alpha Main',
          submitted: '2 of 3',
          missed: 1,
          pending: 1,
          compliance: 67,
          missed_dates: '12 Jul',
          filed_today: 1,
        },
      ]);
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key);
      expect(metric('submitted').value).toBe('2 of 3');
      expect(metric('pending')).toMatchObject({ label: 'Pending (1 filed)', value: 1 });
      expect(metric('filed_today').value).toBe(1);
    });

    it('RP-KIT4. both need tasks.reports.view', async () => {
      for (const key of ['tasks.kitchen', 'tasks.kitchen_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Branch Head Opening reports', () => {
    const range = { from: '2026-08-10', to: '2026-08-12' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const openingTask = async (
      day: string,
      status: TaskStatus,
      extra: {
        completedAt?: Date;
        due?: Date;
        assignee?: string | null;
        answers?: Array<{ label: string; value: string | null }>;
      } = {},
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Branch Head Opening ${day} ${status} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Branch Head Opening Checklist',
          status,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: extra.assignee === undefined ? analystA.id : extra.assignee,
          created_at: new Date(`${day}T01:00:00.000Z`),
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
          completed_by: extra.completedAt ? analystA.id : null,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: (extra.answers ?? []).map((a, position) => ({
          task_id: task.id,
          label: a.label,
          position,
          kind: 'TEXT' as const,
          value: a.value,
          is_done: a.value != null,
        })),
      });
      return task;
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Branch Head Opening Checklist' },
      });
      templateId = template.id;

      await openingTask('2026-08-10', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-08-10T05:56:00.000Z'),
        answers: [
          { label: 'Security present as per roster?', value: 'yes' },
          { label: 'CCTV cameras working?', value: '1 is not working' },
          { label: 'Any additional remarks or observations', value: 'restaurant ready' },
        ],
      });
      await openingTask('2026-08-11', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-08-11T06:08:00.000Z'),
        answers: [{ label: 'Security present as per roster?', value: 'N/A' }],
      });
      await openingTask('2026-08-12', TaskStatus.PENDING, { due: new Date('2026-08-12T06:15:00.000Z') });
      // Nobody assigned, and never filed: the worst rate, so listed first.
      await openingTask('2026-08-11', TaskStatus.PENDING, {
        assignee: null,
        due: new Date('2026-08-11T06:15:00.000Z'),
      });
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-BHO1. a row per submission, newest first, dated with the year', async () => {
      const res = await run('tasks.opening');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Branch Head Opening');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted At',
        'Submitted By',
        'Branch',
        'Security',
        'Valet',
        'Grooming',
        'Cashiers',
        'Meat/Veg',
        'Kitchen',
        'Ready',
        'Manager',
        'CCTV',
        'Remarks',
      ]);
      expect(res.body.rows.map((r: any) => r.date)).toEqual(['11 Aug 2026', '10 Aug 2026']);
      expect(res.body.rows[1]).toMatchObject({
        submitted_at: '10 Aug, 11:26 AM',
        submitted_by: 'Ana Lyst',
        branch_name: 'Alpha Main',
        security: 'yes',
        cctv: '1 is not working',
        remarks: 'restaurant ready',
        valet: null,
      });
      // The row carries its task, for the details view to open.
      expect(taskIds).toContain(res.body.rows[0].task_id);
    });

    it('RP-BHO2. the cards: reports, branches, and the window in days', async () => {
      const res = await run('tasks.opening');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(2);
      expect(metric('branches')).toBe(1);
      expect(metric('date_range')).toBe('3d');
    });

    it('RP-BHO3. compliance lists the worst rate first', async () => {
      const res = await run('tasks.opening_compliance');
      expect(res.status).toBe(200);
      expect(res.body.rows.map((r: any) => [r.staff, r.compliance, r.submitted])).toEqual([
        ['Unassigned', 0, '0 of 1'],
        ['Ana Lyst', 67, '2 of 3'],
      ]);
      expect(res.body.rows[1].filed_today).toBe(0);
    });

    it('RP-BHO4. both need tasks.reports.view', async () => {
      for (const key of ['tasks.opening', 'tasks.opening_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Banquet Opening reports', () => {
    const range = { from: '2026-08-20', to: '2026-08-21' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const bqtTask = async (
      day: string,
      status: TaskStatus,
      extra: {
        completedAt?: Date;
        due?: Date;
        answers?: Array<{ label: string; kind: 'TEXT' | 'YES_NO'; value: string | null }>;
      } = {},
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Banquet Opening ${day} ${status} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Banquet Opening Checklist',
          status,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          due_at: extra.due ?? null,
          completed_at: extra.completedAt ?? null,
          completed_by: extra.completedAt ? analystA.id : null,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: (extra.answers ?? []).map((a, position) => ({
          task_id: task.id,
          label: a.label,
          position,
          kind: a.kind,
          value: a.value,
          is_done: a.value != null,
        })),
      });
      return task;
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Banquet Opening Checklist' },
      });
      templateId = template.id;

      await bqtTask('2026-08-20', TaskStatus.COMPLETED, {
        completedAt: new Date('2026-08-20T06:20:00.000Z'),
        answers: [
          { label: 'Number of parties (L/D), Pax guarantee & Hall name', kind: 'TEXT', value: 'L-70 pax Royale' },
          { label: 'Q1. Is the hall clean and tidy?', kind: 'YES_NO', value: 'YES' },
          { label: 'Q7. Are all TVs in the Banquet Halls working?', kind: 'YES_NO', value: 'NO' },
          { label: 'Any additional remarks (optional)', kind: 'TEXT', value: 'Chaufing dish Legs to be fixed' },
        ],
      });
      await bqtTask('2026-08-21', TaskStatus.PENDING, { due: new Date('2026-08-21T12:00:00.000Z') });
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-BQO1. a row per submission with every answer, yes/no read as Yes/No', async () => {
      const res = await run('tasks.banquet_opening');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Banquet Opening');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted At',
        'Submitted By',
        'Branch',
        'Party Bookings',
        'Hall Clean',
        'Toilets',
        'Chair/Cloths',
        'AC',
        'Room AC',
        'Lights',
        'TVs',
        'Speakers',
        'Amps',
        'Projectors',
        'Remarks',
      ]);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0]).toMatchObject({
        date: '20 Aug 2026',
        submitted_at: '20 Aug, 11:50 AM',
        branch_name: 'Alpha Main',
        party_bookings: 'L-70 pax Royale',
        hall_clean: 'Yes',
        tvs: 'No',
        toilets: null,
        remarks: 'Chaufing dish Legs to be fixed',
      });
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(1);
      expect(metric('date_range')).toBe('2d');
    });

    it('RP-BQO2. compliance for this form alone', async () => {
      const res = await run('tasks.banquet_opening_compliance');
      expect(res.status).toBe(200);
      expect(res.body.rows.map((r: any) => [r.staff, r.submitted, r.missed_dates])).toEqual([
        ['Ana Lyst', '1 of 2', '21 Aug'],
      ]);
    });

    it('RP-BQO3. both need tasks.reports.view', async () => {
      for (const key of ['tasks.banquet_opening', 'tasks.banquet_opening_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('BM Checklist reports', () => {
    const range = { from: '2026-08-25', to: '2026-08-26' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const GROOMED =
      'Are all the staff well-groomed as per the Samco standards? (clean and ironed uniform, with name badge, well-polished shoes)';
    const DAILY = [
      GROOMED,
      'TV & Music is on?',
      'Is the scheduled staff present and on time?',
      'Is the dining area clean and presentable? (Tables, chairs, floors, windows, etc.)',
      'Are all equipment and appliances functioning properly? (Lights, air conditioning, POS system)',
      'Has the restroom been cleaned & sanitized properly and checklist has been filled?',
    ];
    const BRIEFING = ['Grooming', 'Cleanliness', "Yesterday's Feedback", "Day's Special", 'Menu Knowledge', 'Staff Concern'];

    const bmTask = async (day: string, completedAt: Date, answers: Array<[string, 'TEXT' | 'YES_NO', string | null]>) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `BM Checklist ${day} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'BM Checklist',
          status: TaskStatus.COMPLETED,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          completed_at: completedAt,
          completed_by: analystA.id,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: answers.map(([label, kind, value], position) => ({
          task_id: task.id,
          label,
          position,
          kind,
          value,
          is_done: value != null,
        })),
      });
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'BM Checklist' },
      });
      templateId = template.id;

      // Every daily check Yes; five of six briefing points.
      await bmTask('2026-08-25', new Date('2026-08-25T06:02:00.000Z'), [
        ['Manager Name', 'TEXT', 'Rajendiran'],
        ...DAILY.map((f): [string, 'YES_NO', string] => [f, 'YES_NO', 'YES']),
        ...BRIEFING.map((f, i): [string, 'YES_NO', string] => [f, 'YES_NO', i === 5 ? 'NO' : 'YES']),
        ['Remarks/Comments', 'TEXT', 'sofa works still ongoing'],
      ]);
      // TV & Music off; one briefing point skipped.
      await bmTask('2026-08-26', new Date('2026-08-26T05:58:00.000Z'), [
        ['Manager Name', 'TEXT', 'Mr Vasu'],
        ...DAILY.map((f): [string, 'YES_NO', string] => [f, 'YES_NO', f === 'TV & Music is on?' ? 'NO' : 'YES']),
        ...BRIEFING.map((f, i): [string, 'YES_NO', string | null] => [f, 'YES_NO', i === 0 ? null : 'YES']),
        ['Remarks/Comments', 'TEXT', 'manageable'],
      ]);
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-BM1. a row per submission with its daily and briefing scores', async () => {
      const res = await run('tasks.bm');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('BM Checklist');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted At',
        'Submitted By',
        'Branch',
        'Manager',
        'Daily Score',
        'Briefing Score',
        'Staff Groomed',
        'TV/Music',
        'Staff On Time',
        'Dining Clean',
        'Equipment',
        'Restroom',
        'Remarks',
      ]);
      expect(res.body.rows.map((r: any) => [r.date, r.manager, r.daily_score, r.briefing_score, r.tv_music])).toEqual([
        ['26 Aug 2026', 'Mr Vasu', '5/6', '5/6', 'No'],
        ['25 Aug 2026', 'Rajendiran', '6/6', '5/6', 'Yes'],
      ]);
      expect(res.body.rows[1]).toMatchObject({ staff_groomed: 'Yes', remarks: 'sofa works still ongoing' });
    });

    it('RP-BM2. the cards average each score over the period', async () => {
      const res = await run('tasks.bm');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(2);
      expect(metric('avg_daily')).toBe('5.5/6');
      expect(metric('avg_briefing')).toBe('5/6');
    });

    it('RP-BM3. both need tasks.reports.view', async () => {
      for (const key of ['tasks.bm', 'tasks.bm_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Kitchen Balance reports', () => {
    const range = { from: '2026-09-01', to: '2026-09-02' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const kbTask = async (
      day: string,
      completedAt: Date,
      items: Array<[label: string, section: string, kind: 'NUMBER' | 'DATE', value: string | null]>,
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Kitchen Balance ${day} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Kitchen Balance Report',
          status: TaskStatus.COMPLETED,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          completed_at: completedAt,
          completed_by: analystA.id,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: items.map(([label, section, kind, value], position) => ({
          task_id: task.id,
          label,
          section,
          position,
          kind,
          value,
          is_done: value != null,
        })),
      });
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Kitchen Balance Report' },
      });
      templateId = template.id;

      await kbTask('2026-09-01', new Date('2026-09-01T06:23:00.000Z'), [
        ['Chicken Biryani Rice', 'Biryani', 'NUMBER', '5'],
        ['Mutton Biryani Rice', 'Biryani', 'NUMBER', '4'],
        ['Chicken Mandi Pc', 'Mandi', 'NUMBER', '4'],
        ['Ribs — last supplied date', 'Mandi', 'DATE', '2026-08-30'],
        ['Khubus', 'Breads', 'NUMBER', '42'],
        ['Kurma Gravy', 'Indian', 'NUMBER', '20'],
        ['Crab Meat (KG)', 'Fish', 'NUMBER', '2.5'],
        ['Tandoor Chicken', 'Tandoor', 'NUMBER', '9'],
        ['Shawarma', 'BBQ', 'NUMBER', '11'],
      ]);
      await kbTask('2026-09-02', new Date('2026-09-02T06:19:00.000Z'), [
        ['Chicken Biryani Rice', 'Biryani', 'NUMBER', null],
        ['Tandoor Chicken', 'Tandoor', 'NUMBER', '10'],
        ['Khubus', 'Breads', 'NUMBER', '40'],
      ]);
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-KB1. a row per submission: the total of every count, then section subtotals', async () => {
      const res = await run('tasks.kitchen_balance');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Kitchen Balance');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted By',
        'Branch',
        'Total',
        'Biryani',
        'Mandi',
        'Tandoor',
        'BBQ',
        'Breads',
        'Submitted At',
      ]);
      expect(res.body.rows[0]).toMatchObject({
        date: '2 Sep 2026',
        total: 50,
        biryani: 0,
        mandi: 0,
        tandoor: 10,
        breads: 40,
        submitted_at: '2 Sep, 11:49 AM',
      });
      // Indian and Fish count in the total though they have no column; a
      // last-supplied date counts nowhere.
      expect(res.body.rows[1]).toMatchObject({
        date: '1 Sep 2026',
        total: 97.5,
        biryani: 9,
        mandi: 4,
        tandoor: 9,
        bbq: 11,
        breads: 42,
      });
    });

    it('RP-KB2. the cards: reports, all items counted, and the average per report', async () => {
      const res = await run('tasks.kitchen_balance');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(2);
      expect(metric('total_items')).toBe(147.5);
      expect(metric('avg_items')).toBe(74);
    });

    it('RP-KB3. both need tasks.reports.view', async () => {
      for (const key of ['tasks.kitchen_balance', 'tasks.kitchen_balance_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Biryani Sales reports', () => {
    const range = { from: '2026-09-05', to: '2026-09-06' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const bsTask = async (
      day: string,
      completedAt: Date,
      items: Array<[section: string, label: string, kind: 'NUMBER' | 'TEXT', value: string | null]>,
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Biryani Sales ${day} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Biryani Sales Report',
          status: TaskStatus.COMPLETED,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          completed_at: completedAt,
          completed_by: analystA.id,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: items.map(([section, label, kind, value], position) => ({
          task_id: task.id,
          label,
          section,
          position,
          kind,
          value,
          is_done: value != null,
        })),
      });
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Biryani Sales Report' },
      });
      templateId = template.id;

      // The same four questions under each product: all of them count.
      await bsTask('2026-09-05', new Date('2026-09-05T15:40:00.000Z'), [
        ['Chicken Biryani (Non-Veg)', 'Purchase (KG)', 'NUMBER', '12.5'],
        ['Chicken Biryani (Non-Veg)', 'Morning (KG)', 'NUMBER', '5'],
        ['Chicken Biryani (Non-Veg)', 'Evening (KG)', 'NUMBER', '6'],
        ['Chicken Biryani (Non-Veg)', 'Order Qty (KG)', 'NUMBER', '10'],
        ['Mutton Biryani (Non-Veg)', 'Purchase (KG)', 'NUMBER', '8'],
        ['Mutton Biryani (Non-Veg)', 'Morning (KG)', 'NUMBER', '3'],
        ['Mutton Biryani (Non-Veg)', 'Evening (KG)', 'NUMBER', '4.5'],
        ['Mutton Biryani (Non-Veg)', 'Order Qty (KG)', 'NUMBER', null],
        ['Remarks', 'Remarks', 'TEXT', 'Mutton ran out by 9 PM'],
      ]);
      await bsTask('2026-09-06', new Date('2026-09-06T15:30:00.000Z'), [
        ['Appam (Veg)', 'Purchase (KG)', 'NUMBER', '2'],
        ['Appam (Veg)', 'Morning (KG)', 'NUMBER', '1'],
      ]);
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-BS1. a row per submission, each figure totalled over every product', async () => {
      const res = await run('tasks.biryani_sales');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Biryani Sales');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Date',
        'Submitted By',
        'Branch',
        'Purchase (KG)',
        'Morning (KG)',
        'Evening (KG)',
        'Order Qty (KG)',
        'Remarks',
        'Submitted At',
      ]);
      expect(res.body.rows[0]).toMatchObject({ date: '6 Sep 2026', purchase_kg: 2, morning_kg: 1, evening_kg: 0 });
      expect(res.body.rows[1]).toMatchObject({
        date: '5 Sep 2026',
        purchase_kg: 20.5,
        morning_kg: 8,
        evening_kg: 10.5,
        order_qty_kg: 10,
        remarks: 'Mutton ran out by 9 PM',
        submitted_at: '5 Sep, 9:10 PM',
      });
    });

    it('RP-BS2. the cards: reports, and purchase, morning and evening in KG', async () => {
      const res = await run('tasks.biryani_sales');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_reports')).toBe(2);
      expect(metric('purchase')).toBe('22.5 KG');
      expect(metric('morning_sales')).toBe('9 KG');
      expect(metric('evening_sales')).toBe('10.5 KG');
    });

    it('RP-BS3. both need tasks.reports.view', async () => {
      for (const key of ['tasks.biryani_sales', 'tasks.biryani_sales_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Stock Request reports', () => {
    const range = { from: '2026-09-08', to: '2026-09-09' };
    const taskIds: string[] = [];
    const routineIds: string[] = [];
    let templateId: string;

    const srTask = async (
      day: string,
      completedAt: Date,
      items: Array<[section: string | null, label: string, kind: 'TEXT' | 'DATE', value: string | null]>,
    ) => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Stock Request ${day} ${taskIds.length}`,
          frequency: 'DAILY',
          time_of_day: '00:00',
          checklist_template_id: templateId,
        },
      });
      routineIds.push(routine.id);
      const task = await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: 'Kitchen Stock Request',
          status: TaskStatus.COMPLETED,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date(`${day}T00:00:00.000Z`),
          checklist_template_id: templateId,
          assignee_id: analystA.id,
          created_at: new Date(`${day}T01:00:00.000Z`),
          completed_at: completedAt,
          completed_by: analystA.id,
        },
      });
      taskIds.push(task.id);
      await prisma.taskChecklistItem.createMany({
        data: items.map(([section, label, kind, value], position) => ({
          task_id: task.id,
          label,
          section,
          position,
          kind,
          value,
          is_done: value != null,
        })),
      });
    };

    const run = (key: string, options: Record<string, string> = {}) =>
      asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query({ ...range, ...options });

    beforeAll(async () => {
      const template = await prisma.checklistTemplate.create({
        data: { company_id: companyA.id, name: 'Kitchen Stock Request' },
      });
      templateId = template.id;

      // One request for two departments: two rows.
      await srTask('2026-09-09', new Date('2026-09-09T04:30:00.000Z'), [
        ['Request Details', 'Needed by', 'DATE', '2026-09-10'],
        ['Indian', 'Items requested', 'TEXT', 'Rice 10kg\nOil 5L\nOnion 20kg'],
        ['Chinese', 'Items requested', 'TEXT', null],
        ['BBQ', 'Items requested', 'TEXT', 'Charcoal 2 bags'],
      ]);
      // Filed on the form before it was split by department.
      await srTask('2026-09-08', new Date('2026-09-08T04:00:00.000Z'), [
        [null, 'Items requested', 'TEXT', 'Salt, Sugar'],
        [null, 'Needed by', 'DATE', null],
      ]);
    });

    afterAll(async () => {
      await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.taskRoutine.deleteMany({ where: { id: { in: routineIds } } });
      await prisma.checklistTemplate.delete({ where: { id: templateId } });
    });

    it('RP-SR1. a row per department asked for, newest first; an unsplit request is Legacy', async () => {
      const res = await run('tasks.stock_requests');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Stock Requests');
      expect(res.body.option_specs).toEqual([
        {
          key: 'department',
          label: 'Department',
          values: ['Indian', 'Chinese', 'Tandoori', 'BBQ', 'Turkish', 'Staff Food', 'Pick Up', 'Legacy'],
        },
      ]);
      expect(res.body.rows.map((r: any) => [r.date, r.department, r.item_count, r.needed_by])).toEqual([
        ['9 Sep 2026', 'Indian', 3, '10 Sep 2026'],
        ['9 Sep 2026', 'BBQ', 1, '10 Sep 2026'],
        ['8 Sep 2026', 'Legacy', 2, null],
      ]);
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('total_requests')).toBe(2);
      expect(metric('total_items')).toBe(6);
      expect(metric('avg_items')).toBe(3);
      expect(metric('departments')).toBe(3);
    });

    it('RP-SR2. the Department filter keeps only that department, and counts its requests', async () => {
      const res = await run('tasks.stock_requests', { department: 'BBQ' });
      expect(res.status).toBe(200);
      expect(res.body.rows.map((r: any) => [r.department, r.items])).toEqual([['BBQ', 'Charcoal 2 bags']]);
      expect(res.body.metrics.find((m: any) => m.key === 'total_requests').value).toBe(1);
    });

    it('RP-SR3. both need tasks.reports.view', async () => {
      for (const key of ['tasks.stock_requests', 'tasks.stock_requests_compliance']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('POS reports', () => {
    // 20 Sep on the branch's clock (Asia/Kolkata): 18:30Z on the 19th to 18:30Z on the 20th.
    const day = { from: '2026-09-20', to: '2026-09-20' };
    const orderIds: string[] = [];

    const order = async (
      number: string,
      opts: {
        type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
        status: 'OPEN' | 'PAID' | 'CANCELLED';
        at: string;
        total: number;
        items?: Array<[name: string, qty: number, lineTotal: number]>;
        payments?: Array<['CASH' | 'CARD' | 'UPI', number]>;
        branchId?: string;
      },
    ) => {
      const at = new Date(opts.at);
      const o = await prisma.posOrder.create({
        data: {
          company_id: companyA.id,
          branch_id: opts.branchId ?? branchA.id,
          order_number: number,
          order_type: opts.type,
          status: opts.status,
          table_label: opts.type === 'DINE_IN' ? 'T4' : null,
          total_minor: opts.total,
          currency: 'INR',
          opened_at: at,
          paid_at: opts.status === 'PAID' ? at : null,
          cancelled_at: opts.status === 'CANCELLED' ? at : null,
          items: {
            create: (opts.items ?? []).map(([name, quantity, line], position) => ({
              name,
              quantity,
              unit_price_minor: Math.round(line / quantity),
              line_total_minor: line,
              position,
            })),
          },
          payments: {
            create: (opts.payments ?? []).map(([method, amount]) => ({ method, amount_minor: amount, paid_at: at })),
          },
        },
      });
      orderIds.push(o.id);
    };

    const run = (key: string, window = day) =>
      asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(window);

    beforeAll(async () => {
      // 1:00 PM local: dine-in, paid in cash and card.
      await order('A-101', {
        type: 'DINE_IN',
        status: 'PAID',
        at: '2026-09-20T07:30:00.000Z',
        total: 60_000,
        items: [
          ['Chicken Biryani', 2, 50_000],
          ['Lime Soda', 1, 10_000],
        ],
        payments: [
          ['CASH', 20_000],
          ['CARD', 40_000],
        ],
      });
      // 7:10 PM local: takeaway, paid by UPI — the biggest hour.
      await order('A-102', {
        type: 'TAKEAWAY',
        status: 'PAID',
        at: '2026-09-20T13:40:00.000Z',
        total: 90_000,
        items: [['Chicken Biryani', 3, 75_000], ['Mutton Mandi', 1, 15_000]],
        payments: [['UPI', 90_000]],
      });
      // Cancelled, and still open: orders, but no revenue.
      await order('A-103', { type: 'TAKEAWAY', status: 'CANCELLED', at: '2026-09-20T14:00:00.000Z', total: 5_000 });
      await order('A-104', { type: 'DINE_IN', status: 'OPEN', at: '2026-09-20T15:00:00.000Z', total: 12_000 });
      // 11:50 PM local on the 19th: the day before, whenever it was settled.
      await order('A-099', { type: 'DINE_IN', status: 'PAID', at: '2026-09-19T18:20:00.000Z', total: 70_000 });
      // Another branch's order never counts.
      await order('B-001', {
        type: 'DINE_IN',
        status: 'PAID',
        at: '2026-09-20T08:00:00.000Z',
        total: 99_000,
        branchId: branchA2.id,
      });
    });

    afterAll(async () => {
      await prisma.posPayment.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.posOrder.deleteMany({ where: { id: { in: orderIds } } });
    });

    it('RP-POS1. summary: revenue from paid orders only, orders by type, and the success rate', async () => {
      const res = await run('pos.summary');
      expect(res.status).toBe(200);
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key);
      expect(metric('total_revenue')).toMatchObject({ value: 150_000, currency: 'INR' });
      expect(metric('paid_orders').value).toBe(2);
      expect(metric('total_orders').value).toBe(4);
      // The cancelled takeaway is not a takeaway sale.
      expect(metric('dine_in').value).toBe(2);
      expect(metric('takeaway').value).toBe(1);
      expect(metric('avg_order').value).toBe(75_000);
      expect(metric('cancelled').value).toBe(1);
      expect(metric('success_rate').value).toBe(50);
      // Payment methods, biggest first.
      expect(res.body.rows.map((r: any) => [r.method, r.orders, r.amount_minor])).toEqual([
        ['UPI', 1, 90_000],
        ['Card', 1, 40_000],
        ['Cash', 1, 20_000],
      ]);
    });

    it('RP-POS2. orders: every order opened that day, newest first', async () => {
      const res = await run('pos.orders');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(4);
      expect(res.body.rows.map((r: any) => [r.order_number, r.status, r.items, r.payment])).toEqual([
        ['A-104', 'OPEN', 0, null],
        ['A-103', 'CANCELLED', 0, null],
        ['A-102', 'PAID', 4, 'UPI'],
        ['A-101', 'PAID', 3, 'Card, Cash'],
      ]);
    });

    it('RP-POS3. analytics: peak hour on the branch clock, and items sold', async () => {
      const res = await run('pos.analytics');
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key).value;
      expect(metric('revenue')).toBe(150_000);
      expect(metric('all_orders')).toBe(4);
      expect(metric('peak_hour')).toBe('7 PM');
      expect(res.body.rows.map((r: any) => [r.item, r.quantity, r.revenue_minor])).toEqual([
        ['Chicken Biryani', 5, 125_000],
        // Tied on quantity: the bigger earner first.
        ['Mutton Mandi', 1, 15_000],
        ['Lime Soda', 1, 10_000],
      ]);
    });

    it('RP-POS4. revenue by hour and by order type, paid orders only', async () => {
      const byHour = await run('pos.revenue_by_hour');
      expect(byHour.body.rows.map((r: any) => [r.hour_label, r.revenue_minor])).toEqual([
        ['1 PM', 60_000],
        ['7 PM', 90_000],
      ]);
      const byType = await run('pos.revenue_by_type');
      expect(byType.body.rows.map((r: any) => [r.order_type, r.orders, r.revenue_minor])).toEqual([
        ['Takeaway', 1, 90_000],
        ['Dine In', 1, 60_000],
      ]);
    });

    it('RP-POS5. an empty day reads as zeros and a dash, in rupees', async () => {
      const res = await run('pos.analytics', { from: '2026-09-25', to: '2026-09-25' });
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key);
      expect(metric('revenue')).toMatchObject({ value: 0, currency: 'INR' });
      expect(metric('peak_hour').value).toBeNull();
      expect(res.body.rows).toEqual([]);
    });

    it('RP-POS6. every POS report needs pos.reports.view', async () => {
      for (const key of ['pos.summary', 'pos.orders', 'pos.analytics', 'pos.revenue_by_hour', 'pos.revenue_by_type']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(day);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Purchase reports', () => {
    // 17–18 Sep on the branch's clock (Asia/Kolkata).
    const range = { from: '2026-09-17', to: '2026-09-18' };
    const orderIds: string[] = [];
    const vendorIds: string[] = [];

    const vendor = async (name: string) => {
      const v = await prisma.vendor.create({ data: { company_id: companyA.id, name } });
      vendorIds.push(v.id);
      return v.id;
    };

    const po = async (
      number: string,
      vendorId: string,
      opts: {
        at: string;
        total: number;
        sent?: boolean;
        status?: 'ORDERED' | 'RECEIVED' | 'CANCELLED';
        items: Array<[name: string, qty: string, unit: string | null, line: number]>;
        branchId?: string;
      },
    ) => {
      const at = new Date(opts.at);
      const status = opts.status ?? 'ORDERED';
      const o = await prisma.purchaseOrder.create({
        data: {
          company_id: companyA.id,
          branch_id: opts.branchId ?? branchA.id,
          vendor_id: vendorId,
          po_number: number,
          status,
          total_minor: opts.total,
          currency: 'INR',
          ordered_at: at,
          whatsapp_sent_at: opts.sent ? at : null,
          received_at: status === 'RECEIVED' ? at : null,
          cancelled_at: status === 'CANCELLED' ? at : null,
          items: {
            create: opts.items.map(([name, quantity, unit, line], position) => ({
              name,
              quantity,
              unit,
              unit_price_minor: line,
              line_total_minor: line,
              position,
            })),
          },
        },
      });
      orderIds.push(o.id);
    };

    const run = (key: string) => asAnalyst(request(http).get(`/api/v1/reports/${key}/data`)).query(range);

    beforeAll(async () => {
      const fresh = await vendor('Fresh Farms');
      const metro = await vendor('Metro Wholesale');
      await po('PO-1', fresh, {
        at: '2026-09-17T05:00:00.000Z',
        total: 250_000,
        sent: true,
        items: [
          ['Onion', '20', 'kg', 60_000],
          ['Tomato', '12.5', 'kg', 90_000],
          ['Coriander', '5', 'bunch', 100_000],
        ],
      });
      await po('PO-2', metro, {
        at: '2026-09-18T06:00:00.000Z',
        total: 180_000,
        status: 'RECEIVED',
        items: [
          ['Onion', '10', 'kg', 30_000],
          ['Basmati Rice', '25', 'kg', 150_000],
        ],
      });
      // Cancelled: never bought, counts nowhere.
      await po('PO-3', metro, {
        at: '2026-09-18T07:00:00.000Z',
        total: 99_000,
        sent: true,
        status: 'CANCELLED',
        items: [['Oil', '15', 'L', 99_000]],
      });
      // Another branch's order never counts.
      await po('PO-4', fresh, {
        at: '2026-09-17T05:00:00.000Z',
        total: 77_000,
        branchId: branchA2.id,
        items: [['Onion', '99', 'kg', 77_000]],
      });
    });

    afterAll(async () => {
      await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    });

    it('RP-PUR1. the cards: amount, item lines, vendors, and WhatsApp sent of all — cancelled left out', async () => {
      const res = await run('purchase.by_vendor');
      expect(res.status).toBe(200);
      const metric = (key: string) => res.body.metrics.find((m: any) => m.key === key);
      expect(metric('total_amount')).toMatchObject({ value: 430_000, currency: 'INR' });
      expect(metric('total_items').value).toBe(5);
      expect(metric('vendors').value).toBe(2);
      expect(metric('whatsapp_sent').value).toBe('1/2');
    });

    it('RP-PUR2. by vendor: every order, newest first, with its vendor, source, status and whether it was sent', async () => {
      const res = await run('purchase.by_vendor');
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Created At',
        'Invoice',
        'Vendor',
        'Branch',
        'Source',
        'Items',
        'Total',
        'Status',
        'Sent',
      ]);
      expect(
        res.body.rows.map((r: any) => [
          r.created_at,
          r.invoice,
          r.vendor,
          r.branch_name,
          r.source,
          r.items,
          r.total_minor,
          r.status,
          r.sent,
        ]),
      ).toEqual([
        ['18 Sep, 11:30 AM', 'PO-2', 'Metro Wholesale', 'Alpha Main', 'MANUAL', 2, 180_000, 'RECEIVED', 'No'],
        ['17 Sep, 10:30 AM', 'PO-1', 'Fresh Farms', 'Alpha Main', 'MANUAL', 3, 250_000, 'ORDERED', 'Yes'],
      ]);
    });

    it('RP-PUR3. by item: quantities add within a unit across vendors, with the average rate and last order', async () => {
      const res = await run('purchase.by_item');
      expect(res.status).toBe(200);
      expect(res.body.columns.map((c: any) => c.label)).toEqual([
        'Item',
        'Unit',
        'Branch',
        'Total Qty',
        'Avg Rate',
        'Total',
        'Orders',
        'Last Ordered',
      ]);
      expect(
        res.body.rows.map((r: any) => [
          r.item,
          r.unit,
          r.total_qty,
          r.avg_rate_minor,
          r.total_minor,
          r.orders,
          r.last_ordered,
        ]),
      ).toEqual([
        ['Basmati Rice', 'kg', 25, 6_000, 150_000, 1, '18 Sep, 11:30 AM'],
        ['Coriander', 'bunch', 5, 20_000, 100_000, 1, '17 Sep, 10:30 AM'],
        ['Onion', 'kg', 30, 3_000, 90_000, 2, '18 Sep, 11:30 AM'],
        ['Tomato', 'kg', 12.5, 7_200, 90_000, 1, '17 Sep, 10:30 AM'],
      ]);
      // The vendors ride along for the search box, though they are not a column.
      expect(res.body.rows.find((r: any) => r.item === 'Onion').vendors).toBe('Fresh Farms, Metro Wholesale');
    });

    it('RP-PUR4. both need purchase.reports.view', async () => {
      for (const key of ['purchase.by_vendor', 'purchase.by_item']) {
        const res = await as(
          request(http).get(`/api/v1/reports/${key}/data`),
          tokenQueueOnlyA,
          companyA.id,
          branchA.id,
        ).query(range);
        expect(res.status).toBe(403);
      }
    });
  });

  describe('Inventory', () => {
    // 11–15 Sep, each branch on its own clock: Alpha Main is Asia/Kolkata,
    // Alpha Second is UTC.
    const range = { from: '2026-09-11', to: '2026-09-15' };
    let chicken: string;
    let sevenUp: string;
    let laptop: string;
    let meatId: string;
    let tokenKeeperA: string;

    const inv = (path: string, query: Record<string, string> = {}, token = tokenAnalystA) =>
      as(request(http).get(`/api/v1/inventory/${path}`), token, companyA.id).query(query);

    const move = (branchId: string, itemId: string, kind: string, quantity: number, at: string) =>
      prisma.stockMovement.create({
        data: {
          company_id: companyA.id,
          branch_id: branchId,
          item_id: itemId,
          kind: kind as never,
          quantity,
          occurred_at: new Date(at),
        },
      });

    beforeAll(async () => {
      const beverages = await prisma.inventoryCategory.create({ data: { company_id: companyA.id, name: 'Beverages' } });
      const meat = await prisma.inventoryCategory.create({ data: { company_id: companyA.id, name: 'Meat' } });
      meatId = meat.id;
      const item = (name: string, unit: string, extra: Record<string, unknown> = {}) =>
        prisma.inventoryItem.create({ data: { company_id: companyA.id, name, unit, ...extra } });
      sevenUp = (await item('7 Up Can 300 Ml', 'case', { category_id: beverages.id })).id;
      chicken = (await item('Chicken', 'Kg', { category_id: meat.id, department: 'Indian' })).id;
      laptop = (await item('Laptop', 'BOX')).id;
      await item('Old Stock', 'Kg', { is_active: false });

      await move(branchA.id, chicken, 'OPENING', 10, '2026-09-01T00:00:00.000Z');
      // 20:00 UTC on the 10th: the 11th in Kolkata, still the 10th in UTC.
      await move(branchA.id, chicken, 'PURCHASE', 5, '2026-09-10T20:00:00.000Z');
      await move(branchA.id, chicken, 'CONSUMPTION', -3, '2026-09-12T06:00:00.000Z');
      await move(branchA.id, chicken, 'CONSUMPTION', -1, '2026-09-20T06:00:00.000Z');
      await move(branchA2.id, chicken, 'PURCHASE', 2, '2026-09-10T20:00:00.000Z');
      await move(branchA2.id, sevenUp, 'OPENING', 4.5, '2026-09-01T00:00:00.000Z');

      const vendor = await prisma.vendor.create({ data: { company_id: companyA.id, name: 'Inventory Metro' } });
      const po = (branchId: string, n: string, status: string, total: number, paid: number, at: string) =>
        prisma.purchaseOrder.create({
          data: {
            company_id: companyA.id,
            branch_id: branchId,
            vendor_id: vendor.id,
            po_number: n,
            status: status as never,
            total_minor: total,
            paid_minor: paid,
            currency: 'INR',
            ordered_at: new Date(at),
            received_at: status === 'RECEIVED' ? new Date(at) : null,
            cancelled_at: status === 'CANCELLED' ? new Date(at) : null,
          },
        });
      await po(branchA.id, 'INV-1', 'ORDERED', 100_000, 40_000, '2026-09-11T05:00:00.000Z');
      await po(branchA.id, 'INV-2', 'RECEIVED', 50_000, 50_000, '2026-09-12T05:00:00.000Z');
      await po(branchA2.id, 'INV-3', 'ORDERED', 30_000, 0, '2026-09-01T05:00:00.000Z');
      await po(branchA.id, 'INV-4', 'CANCELLED', 99_999, 0, '2026-09-12T05:00:00.000Z');

      // A stock keeper who may see Alpha Main's inventory, and nothing else.
      const keeperRole = await prisma.role.create({ data: { company_id: companyA.id, name: 'Stock Keeper' } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { name: 'inventory.view' } });
      await prisma.rolePermission.create({ data: { role_id: keeperRole.id, permission_id: perm.id } });
      const keeper = await prisma.user.create({
        data: { email: 'r-keeper-a@test.com', password_hash: await bcrypt.hash(PASSWORD, SALT) },
      });
      await prisma.companyMembership.create({
        data: { user_id: keeper.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({ data: { user_id: keeper.id, branch_id: branchA.id, role_id: keeperRole.id } });
      tokenKeeperA = (await request(http).post('/api/v1/auth/login').send({ email: 'r-keeper-a@test.com', password: PASSWORD }))
        .body.accessToken;
    });

    afterAll(async () => {
      // Movements point at purchases, and purchase lines at items: in that order.
      await prisma.stockMovement.deleteMany({ where: { company_id: companyA.id } });
      await prisma.stockTransfer.deleteMany({ where: { company_id: companyA.id } });
      await prisma.menuProduct.deleteMany({ where: { company_id: companyA.id } });
      await prisma.purchaseOrder.deleteMany({
        where: {
          OR: [
            { po_number: { startsWith: 'INV-' } },
            { po_number: { startsWith: 'MP-' } },
            { po_number: { startsWith: 'ORD-' } },
          ],
        },
      });
      await prisma.inventoryItem.deleteMany({ where: { company_id: companyA.id } });
      await prisma.inventoryCategory.deleteMany({ where: { company_id: companyA.id } });
      await prisma.vendor.deleteMany({
        where: { name: { in: ['Inventory Metro', 'Fresh Farms', 'Main Kitchen', 'Order Metro', 'Order Alt'] } },
      });
    });

    const cellsOf = (res: request.Response, itemId: string) => res.body.items.find((i: any) => i.id === itemId).cells;

    it('IN-1. a column group for every branch the caller may see; stock, consumed and purchase per branch', async () => {
      const res = await inv('overview', range);
      expect(res.status).toBe(200);
      expect(res.body.branches.map((b: any) => b.name)).toEqual(['Alpha Main', 'Alpha Second']);
      // Active items only, by name.
      expect(res.body.items.map((i: any) => [i.name, i.unit, i.category, i.department])).toEqual([
        ['7 Up Can 300 Ml', 'case', 'Beverages', null],
        ['Chicken', 'Kg', 'Meat', 'Indian'],
        ['Laptop', 'BOX', null, null],
      ]);
      expect(res.body.meta.total).toBe(3);
      // Stock is everything ever; consumption on the 20th is outside the period.
      expect(cellsOf(res, chicken)[branchA.id]).toEqual({ stock: 11, consumed: 3, purchase: 5 });
      // The same instant is the 10th in UTC: before the period at Alpha Second.
      expect(cellsOf(res, chicken)[branchA2.id]).toEqual({ stock: 2, consumed: null, purchase: null });
      expect(cellsOf(res, sevenUp)[branchA2.id]).toEqual({ stock: 4.5, consumed: null, purchase: null });
      expect(cellsOf(res, laptop)[branchA.id]).toEqual({ stock: null, consumed: null, purchase: null });
    });

    it('IN-2. the summary: purchase, open and received in the period; outstanding whatever the period', async () => {
      const res = await inv('overview', range);
      expect(res.body.summary).toEqual({
        purchase_minor: 150_000,
        outstanding_minor: 90_000,
        open: 1,
        received: 1,
        currency: 'INR',
      });
      const allTime = await inv('overview');
      expect(allTime.body.summary).toMatchObject({ purchase_minor: 180_000, outstanding_minor: 90_000, open: 2 });
      expect(cellsOf(allTime, chicken)[branchA.id]).toEqual({ stock: 11, consumed: 4, purchase: 5 });
    });

    it('IN-3. category, department, search and branch each narrow what is shown', async () => {
      const names = async (q: Record<string, string>) =>
        (await inv('overview', q)).body.items.map((i: any) => i.name);
      expect(await names({ category_id: meatId })).toEqual(['Chicken']);
      expect(await names({ department: 'Indian' })).toEqual(['Chicken']);
      expect(await names({ q: 'LAP' })).toEqual(['Laptop']);

      const second = await inv('overview', { ...range, branch_id: branchA2.id });
      expect(second.body.branches.map((b: any) => b.name)).toEqual(['Alpha Second']);
      expect(Object.keys(cellsOf(second, chicken))).toEqual([branchA2.id]);
      expect(second.body.summary).toMatchObject({ purchase_minor: 0, outstanding_minor: 30_000, open: 0 });
    });

    it('IN-4. a branch the caller has no inventory access at never appears, and cannot be asked for', async () => {
      const res = await inv('overview', range, tokenKeeperA);
      expect(res.status).toBe(200);
      expect(res.body.branches.map((b: any) => b.name)).toEqual(['Alpha Main']);
      expect(res.body.summary.outstanding_minor).toBe(60_000);
      expect((await inv('overview', { branch_id: branchA2.id }, tokenKeeperA)).status).toBe(403);
      expect((await inv('filters', {}, tokenKeeperA)).body.branches.map((b: any) => b.name)).toEqual(['Alpha Main']);
    });

    it('IN-5. refuses without inventory.view anywhere, without a company, or with half a period', async () => {
      expect((await inv('overview', {}, tokenPlainA)).status).toBe(403);
      expect((await request(http).get('/api/v1/inventory/overview').set('Authorization', `Bearer ${tokenAnalystA}`)).status).toBe(400);
      expect((await inv('overview', { from: '2026-09-11' })).status).toBe(400);
      expect((await inv('overview', { from: '2026-09-15', to: '2026-09-11' })).status).toBe(400);
      expect((await inv('overview', { department: 'Continental' })).status).toBe(400);
    });

    it('IN-6. the filters: branches, the company categories, and the kitchen departments', async () => {
      const res = await inv('filters');
      expect(res.status).toBe(200);
      expect(res.body.branches.map((b: any) => b.name)).toEqual(['Alpha Main', 'Alpha Second']);
      expect(res.body.categories.map((c: any) => c.name)).toEqual(['Beverages', 'Meat']);
      expect(res.body.departments).toEqual(['Indian', 'Chinese', 'Tandoori', 'BBQ', 'Turkish', 'Staff Food', 'Pick Up']);
    });

    describe('Manual purchase', () => {
      let sugar: string;
      let supplierId: string;
      let saleOnlyId: string;

      const post = (path: string, body: object, token = tokenAnalystA) =>
        as(request(http).post(`/api/v1/inventory/${path}`), token, companyA.id).send(body);

      beforeAll(async () => {
        sugar = (
          await prisma.inventoryItem.create({
            data: {
              company_id: companyA.id,
              name: 'Sugar 50 Kg Bag',
              unit: 'Kg',
              purchase_unit: 'Bag',
              conversion_qty: 50,
              purchase_price_minor: 200_000,
              tax_rate_bps: 500,
            },
          })
        ).id;
        saleOnlyId = (
          await prisma.vendor.create({ data: { company_id: companyA.id, name: 'Main Kitchen', type: 'SALE' } })
        ).id;
      });

      it('MP-1. the outlets are where the caller may record purchases; others are refused', async () => {
        const res = await inv('purchase/options');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          outlets: [
            { id: branchA.id, name: 'Alpha Main' },
            { id: branchA2.id, name: 'Alpha Second' },
          ],
          may_create_supplier: true,
        });
        expect((await inv('purchase/options', {}, tokenKeeperA)).status).toBe(403);
      });

      it('MP-2. creates a supplier: name and number required, GST and IFSC checked, names unique', async () => {
        const res = await post('suppliers', {
          name: '  Fresh Farms ',
          phone: '98400 12345',
          gstin: '33ajtpj7001j1z5',
          address: 'Koyambedu',
          bank_account_number: '1234567890',
          bank_ifsc: 'sbin0001234',
          bank_name: 'SBI',
        });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ name: 'Fresh Farms', phone: '98400 12345' });
        supplierId = res.body.id;
        const saved = await prisma.vendor.findUniqueOrThrow({ where: { id: supplierId } });
        expect(saved).toMatchObject({ gstin: '33AJTPJ7001J1Z5', gst_registered: true, bank_ifsc: 'SBIN0001234', type: 'PURCHASE' });

        expect((await post('suppliers', { name: 'fresh farms', phone: '9840012345' })).status).toBe(409);
        expect((await post('suppliers', { name: 'X', phone: '9840012345', gstin: '12345' })).status).toBe(400);
        expect((await post('suppliers', { name: 'X', phone: '9840012345', bank_ifsc: 'SBI1234' })).status).toBe(400);
        expect((await post('suppliers', { name: '', phone: '9840012345' })).status).toBe(400);
        expect((await post('suppliers', { name: 'X' })).status).toBe(400);
        expect((await post('suppliers', { name: 'Y', phone: '9840012345' }, tokenKeeperA)).status).toBe(403);
      });

      it('MP-3. lists active purchase suppliers, and finds products to add', async () => {
        const suppliers = await inv('suppliers', { q: 'fresh' });
        expect(suppliers.body.map((s: any) => s.name)).toEqual(['Fresh Farms']);
        // A "Sale" party is not one to buy from.
        expect((await inv('suppliers', { q: 'main kitchen' })).body).toEqual([]);

        const items = await inv('items', { q: 'SUGAR' }, tokenKeeperA);
        expect(items.status).toBe(200);
        expect(items.body).toEqual([
          {
            id: sugar,
            name: 'Sugar 50 Kg Bag',
            unit: 'Kg',
            purchase_unit: 'Bag',
            conversion_qty: 50,
            purchase_price_minor: 200_000,
            tax_rate_bps: 500,
            category: null,
          },
        ]);
      });

      it('MP-4. records a purchase: received, unpaid, GST on top, stock added in stock units', async () => {
        const res = await post('purchases', {
          branch_id: branchA.id,
          vendor_id: supplierId,
          items: [
            { item_id: sugar, quantity: 2, rate_minor: 200_000 },
            { item_id: chicken, quantity: 1.5, rate_minor: 24_000 },
          ],
        });
        expect(res.status).toBe(201);
        // Sugar: 2 × ₹2,000 + 5% = ₹4,200. Chicken: 1.5 × ₹240, no GST = ₹360.
        expect(res.body).toMatchObject({ total_minor: 456_000, currency: 'INR', branch: 'Alpha Main', vendor: 'Fresh Farms', items: 2 });
        expect(res.body.po_number).toMatch(/^MP-\d{6}-1$/);
        // It arrived with the purchase: one delivery, under our invoice number.
        expect(res.body.invoice_number).toMatch(/^INV-ALP-\d{4}-0001$/);

        const order = await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: res.body.id },
          include: { items: { orderBy: { position: 'asc' } }, stock_movements: true },
        });
        expect(order).toMatchObject({ status: 'RECEIVED', source: 'MANUAL', paid_minor: 0, created_by: analystA.id });
        expect(order.received_at).not.toBeNull();
        expect(order.items.map((i) => [i.name, Number(i.quantity), i.unit, i.unit_price_minor, i.tax_minor, i.line_total_minor])).toEqual([
          ['Sugar 50 Kg Bag', 2, 'Bag', 200_000, 20_000, 420_000],
          ['Chicken', 1.5, 'Kg', 24_000, 0, 36_000],
        ]);

        // Two bags are 100 Kg of stock.
        const grid = await inv('overview', { branch_id: branchA.id });
        const sugarCells = grid.body.items.find((i: any) => i.id === sugar).cells[branchA.id];
        expect(sugarCells).toEqual({ stock: 100, consumed: null, purchase: 100 });
        expect(grid.body.items.find((i: any) => i.id === chicken).cells[branchA.id].stock).toBe(12.5);
        // Unpaid: its whole total is now outstanding.
        expect(grid.body.summary.outstanding_minor).toBe(60_000 + 456_000);

        const again = await post('purchases', {
          branch_id: branchA.id,
          vendor_id: supplierId,
          items: [{ item_id: sugar, quantity: 1, rate_minor: 200_000 }],
        });
        expect(again.body.po_number).toMatch(/-2$/);
      });

      it('MP-5. refuses what it must: another outlet, a sale party, a repeat item, a stranger, nothing to buy', async () => {
        const line = { item_id: sugar, quantity: 1, rate_minor: 100 };
        const base = { branch_id: branchA.id, vendor_id: supplierId, items: [line] };
        expect((await post('purchases', base, tokenKeeperA)).status).toBe(403);
        expect((await post('purchases', { ...base, vendor_id: saleOnlyId })).status).toBe(400);
        expect((await post('purchases', { ...base, items: [line, line] })).status).toBe(400);
        expect(
          (await post('purchases', { ...base, items: [{ ...line, item_id: '00000000-0000-4000-8000-000000000000' }] })).status,
        ).toBe(400);
        expect((await post('purchases', { ...base, items: [{ ...line, quantity: 0 }] })).status).toBe(400);
        expect((await post('purchases', { ...base, items: [] })).status).toBe(400);
        expect((await post('purchases', { ...base, branch_id: branchB.id })).status).toBe(403);
      });
    });

    describe('Transfer stock', () => {
      // After the purchases above, Alpha Main holds 12.5 Kg of chicken and
      // 150 Kg of sugar; Alpha Second 2 Kg of chicken and 4.5 cases of 7 Up.
      let biriyani: string;
      let oldDish: string;

      const send = (body: object, token = tokenAnalystA) =>
        as(request(http).post('/api/v1/inventory/transfers'), token, companyA.id).send(body);

      beforeAll(async () => {
        const product = (name: string, extra: Record<string, unknown> = {}) =>
          prisma.menuProduct.create({ data: { company_id: companyA.id, name, ...extra } });
        biriyani = (await product('Chicken Biriyani', { category: 'Biryani' })).id;
        await product('Appam Batter', { unit: 'Kg' });
        oldDish = (await product('Old Dish', { is_active: false })).id;
      });

      it('TR-1. sends from where the caller may transfer, to any active outlet of the company', async () => {
        const res = await inv('transfer/options');
        expect(res.status).toBe(200);
        expect(res.body.sources.map((b: any) => b.name)).toEqual(['Alpha Main', 'Alpha Second']);
        expect(res.body.destinations.map((b: any) => b.name)).toEqual(expect.arrayContaining(['Alpha Main', 'Alpha Second']));
        expect(res.body.destinations.some((b: any) => b.id === branchB.id)).toBe(false);
        expect((await inv('transfer/options', {}, tokenKeeperA)).status).toBe(403);
      });

      it('TR-2. lists what an outlet can send: raw materials it has on hand, and the menu products', async () => {
        const bare = await inv('transfer/stock');
        expect(bare.status).toBe(200);
        expect(bare.body.raw_materials).toEqual([]);
        expect(bare.body.products.map((p: any) => [p.name, p.category, p.unit])).toEqual([
          ['Appam Batter', null, 'Kg'],
          ['Chicken Biriyani', 'Biryani', null],
        ]);

        const main = await inv('transfer/stock', { branch_id: branchA.id });
        expect(main.body.raw_materials).toEqual([
          { id: chicken, name: 'Chicken', unit: 'Kg', on_hand: 12.5 },
          { id: expect.any(String), name: 'Sugar 50 Kg Bag', unit: 'Kg', on_hand: 150 },
        ]);
        expect((await inv('transfer/stock', { branch_id: branchA.id }, tokenKeeperA)).status).toBe(403);
        expect((await inv('transfer/stock', { branch_id: branchB.id })).status).toBe(403);
      });

      it('TR-3. a transfer lands at once: out of the source, into the destination; a product moves no stock', async () => {
        const res = await send({
          from_branch_id: branchA.id,
          to_branch_id: branchA2.id,
          lines: [
            { kind: 'RAW', id: chicken, quantity: 2.5 },
            { kind: 'PRODUCT', id: biriyani, quantity: 3 },
          ],
          note: ' Evening top-up ',
        });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ from: 'Alpha Main', to: 'Alpha Second', items: 2 });
        expect(res.body.number).toMatch(/^TR-\d{6}-1$/);

        const saved = await prisma.stockTransfer.findUniqueOrThrow({
          where: { id: res.body.id },
          include: { lines: { orderBy: { position: 'asc' } }, movements: { orderBy: { quantity: 'asc' } } },
        });
        expect(saved).toMatchObject({ note: 'Evening top-up', created_by: analystA.id });
        expect(saved.lines.map((l) => [l.name, l.unit, Number(l.quantity), !!l.inventory_item_id, !!l.menu_product_id])).toEqual([
          ['Chicken', 'Kg', 2.5, true, false],
          ['Chicken Biriyani', null, 3, false, true],
        ]);
        expect(saved.movements.map((m) => [m.branch_id, m.kind, Number(m.quantity)])).toEqual([
          [branchA.id, 'TRANSFER_OUT', -2.5],
          [branchA2.id, 'TRANSFER_IN', 2.5],
        ]);

        const grid = await inv('overview');
        const cells = grid.body.items.find((i: any) => i.id === chicken).cells;
        expect([cells[branchA.id].stock, cells[branchA2.id].stock]).toEqual([10, 4.5]);

        const next = await send({
          from_branch_id: branchA.id,
          to_branch_id: branchA2.id,
          lines: [{ kind: 'RAW', id: chicken, quantity: 10 }],
        });
        expect(next.status).toBe(201);
        expect(next.body.number).toMatch(/-2$/);
        // Every last gram may go; then chicken is no longer there to send.
        const after = await inv('transfer/stock', { branch_id: branchA.id });
        expect(after.body.raw_materials.map((r: any) => r.name)).toEqual(['Sugar 50 Kg Bag']);
      });

      it('TR-4. refuses what it must: more than on hand, the same outlet, repeats, strangers, nothing to send', async () => {
        const line = { kind: 'RAW', id: sevenUp, quantity: 1 };
        const base = { from_branch_id: branchA2.id, to_branch_id: branchA.id, lines: [line] };
        const over = await send({ ...base, lines: [{ ...line, quantity: 4.6 }] });
        expect(over.status).toBe(400);
        expect(over.body.message).toBe('Only 4.5 case of 7 Up Can 300 Ml on hand at Alpha Second');
        // Nothing was saved.
        expect(await prisma.stockTransfer.count({ where: { from_branch_id: branchA2.id } })).toBe(0);

        expect((await send({ ...base, to_branch_id: branchA2.id })).status).toBe(400);
        expect((await send({ ...base, lines: [line, line] })).status).toBe(400);
        expect((await send({ ...base, lines: [{ kind: 'PRODUCT', id: oldDish, quantity: 1 }] })).status).toBe(400);
        expect((await send({ ...base, lines: [{ ...line, kind: 'ASSET' }] })).status).toBe(400);
        expect((await send({ ...base, lines: [{ ...line, quantity: 0 }] })).status).toBe(400);
        expect((await send({ ...base, lines: [] })).status).toBe(400);
        expect((await send({ ...base, to_branch_id: branchB.id })).status).toBe(404);
        expect((await send({ ...base, from_branch_id: branchB.id })).status).toBe(403);
        expect((await send(base, tokenKeeperA)).status).toBe(403);

        expect((await send(base)).status).toBe(201);
      });
    });

    describe('Purchase orders', () => {
      // Orders raised to "Order Metro": ORD-1 (two lines, Alpha Main), ORD-2
      // (Alpha Second), ORD-3 (cancelled, Alpha Main).
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      let vendorId: string;
      let otherVendorId: string;
      let ord1: string;
      let ord2: string;
      let chickenLine: string;
      let upLine: string;

      const orders = (query: Record<string, string> = {}, token = tokenAnalystA) => inv('purchase-orders', query, token);
      const call = (method: 'post' | 'patch' | 'delete', path: string, body: object = {}, token = tokenAnalystA) =>
        as(request(http)[method](`/api/v1/inventory/purchase-orders/${path}`), token, companyA.id).send(body);
      const photo = (id: string, token = tokenAnalystA) =>
        call('post', `${id}/photos`, { data: PNG, mime_type: 'image/png', file_name: 'bill.png' }, token);

      beforeAll(async () => {
        vendorId = (await prisma.vendor.create({ data: { company_id: companyA.id, name: 'Order Metro', phone: '9840011111' } })).id;
        otherVendorId = (await prisma.vendor.create({ data: { company_id: companyA.id, name: 'Order Alt' } })).id;
        const raise = (branchId: string, n: string, at: string, lines: Array<[string, string, number, number]>, extra = {}) =>
          prisma.purchaseOrder.create({
            data: {
              company_id: companyA.id,
              branch_id: branchId,
              vendor_id: vendorId,
              po_number: n,
              total_minor: lines.reduce((s, [, , q, p]) => s + q * p, 0),
              currency: 'INR',
              ordered_at: new Date(at),
              created_by: analystA.id,
              items: {
                create: lines.map(([itemId, name, quantity, price], position) => ({
                  name,
                  quantity,
                  unit: 'Kg',
                  unit_price_minor: price,
                  line_total_minor: quantity * price,
                  position,
                  inventory_item_id: itemId,
                })),
              },
              ...extra,
            },
            include: { items: { orderBy: { position: 'asc' } } },
          });
        const one = await raise(branchA.id, 'ORD-1', '2026-09-26T05:00:00.000Z', [
          [chicken, 'Chicken', 4, 25_000],
          [sevenUp, '7 Up Can 300 Ml', 2, 60_000],
        ]);
        ord1 = one.id;
        [chickenLine, upLine] = one.items.map((i) => i.id);
        ord2 = (await raise(branchA2.id, 'ORD-2', '2026-09-27T05:00:00.000Z', [[chicken, 'Chicken', 1, 25_000]])).id;
        await raise(branchA.id, 'ORD-3', '2026-09-25T05:00:00.000Z', [[chicken, 'Chicken', 1, 1_000]], {
          status: 'CANCELLED',
          cancelled_at: new Date('2026-09-25T06:00:00.000Z'),
        });
      });

      it('PO-1. lists orders by tab with counts, cards, the cancelled toggle, filters and sorts', async () => {
        const res = await orders({ vendor_id: vendorId });
        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ all: 2, sent: 2, cancelled: 1 });
        expect(res.body.orders.map((o: any) => o.po_number)).toEqual(['ORD-2', 'ORD-1']);
        const card = res.body.orders.find((o: any) => o.po_number === 'ORD-1');
        expect(card).toMatchObject({
          status: 'ORDERED',
          vendor: { id: vendorId, name: 'Order Metro', phone: '9840011111' },
          branch: { id: branchA.id, name: 'Alpha Main' },
          created_by: expect.any(String),
          items_count: 2,
          received_count: 0,
          chips: [
            { name: 'Chicken', quantity: 4, unit: 'Kg' },
            { name: '7 Up Can 300 Ml', quantity: 2, unit: 'Kg' },
          ],
          more_items: 0,
          total_minor: 220_000,
          invoice_number: null,
          may_edit: true,
        });

        const withCancelled = await orders({ vendor_id: vendorId, include_cancelled: 'true', sort: 'oldest' });
        expect(withCancelled.body.orders.map((o: any) => [o.po_number, o.status])).toEqual([
          ['ORD-3', 'CANCELLED'],
          ['ORD-1', 'ORDERED'],
          ['ORD-2', 'ORDERED'],
        ]);
        expect((await orders({ vendor_id: vendorId, tab: 'received' })).body.orders).toEqual([]);
        expect((await orders({ vendor_id: vendorId, sort: 'amount' })).body.orders[0].po_number).toBe('ORD-1');
        // 26 Sep, Alpha Main's day: only ORD-1.
        const day = await orders({ vendor_id: vendorId, from: '2026-09-26', to: '2026-09-26' });
        expect(day.body.orders.map((o: any) => o.po_number)).toEqual(['ORD-1']);
        const second = await orders({ vendor_id: vendorId, branch_id: branchA2.id });
        expect(second.body.orders.map((o: any) => o.po_number)).toEqual(['ORD-2']);

        // A viewer sees only their branch, and may not change it.
        const keeper = await orders({ vendor_id: vendorId }, tokenKeeperA);
        expect(keeper.body.orders.map((o: any) => [o.po_number, o.may_edit])).toEqual([['ORD-1', false]]);
        expect((await orders({ branch_id: branchA2.id }, tokenKeeperA)).status).toBe(403);
        expect((await orders({ from: '2026-09-26' })).status).toBe(400);
        expect((await orders({}, tokenPlainA)).status).toBe(403);
      });

      it('PO-2. saves edits to the awaited lines and the supplier; totals follow', async () => {
        const res = await call('patch', ord1, {
          vendor_id: otherVendorId,
          lines: [
            { id: chickenLine, item_id: chicken, quantity: 5, rate_minor: 20_000 },
            { item_id: laptop, quantity: 1, rate_minor: 1_000 },
          ],
        });
        expect(res.status).toBe(200);
        expect(res.body.vendor.name).toBe('Order Alt');
        expect(res.body.lines.map((l: any) => [l.name, l.quantity, l.unit_price_minor, l.line_total_minor, l.received])).toEqual([
          ['Chicken', 5, 20_000, 100_000, false],
          ['Laptop', 1, 1_000, 1_000, false],
        ]);
        expect(res.body.total_minor).toBe(101_000);
        expect(res.body.may_edit).toBe(true);
        // Put it back as it was, for what follows.
        const back = await call('patch', ord1, {
          vendor_id: vendorId,
          lines: [
            { id: chickenLine, item_id: chicken, quantity: 4, rate_minor: 25_000 },
            { item_id: sevenUp, quantity: 2, rate_minor: 60_000 },
          ],
        });
        upLine = back.body.lines[1].id;
        expect(back.body.total_minor).toBe(220_000);

        expect((await call('patch', ord1, { lines: [] })).status).toBe(400);
        expect((await call('patch', ord1, { lines: [{ item_id: chicken, quantity: 1, rate_minor: 1 }, { item_id: chicken, quantity: 1, rate_minor: 1 }] })).status).toBe(400);
        expect((await call('patch', ord1, { lines: [{ item_id: chicken, quantity: 1, rate_minor: 1 }] }, tokenKeeperA)).status).toBe(403);
        expect((await inv(`purchase-orders/${ord1}`, {}, tokenKeeperA)).body.may_edit).toBe(false);
      });

      it('PO-3. delivery photos: up to the limit, served back, removable until received', async () => {
        const up = await photo(ord1);
        expect(up.status).toBe(201);
        expect(up.body).toMatchObject({ mime_type: 'image/png', file_name: 'bill.png', received: false });
        const bytes = await as(request(http).get(`/api/v1/inventory/purchase-orders/${ord1}/photos/${up.body.id}`), tokenKeeperA, companyA.id);
        expect(bytes.status).toBe(200);
        expect(bytes.headers['content-type']).toBe('image/png');
        expect((await call('delete', `${ord1}/photos/${up.body.id}`)).status).toBe(204);
        expect((await call('post', `${ord1}/photos`, { data: PNG, mime_type: 'application/pdf' })).status).toBe(400);
        expect((await photo(ord1, tokenKeeperA)).status).toBe(403);
      });

      it('PO-4. receives the ticked lines as one delivery; the rest wait for the next', async () => {
        const lines = [
          { id: chickenLine, item_id: chicken, quantity: 4, rate_minor: 25_000, receive: true },
          { id: upLine, item_id: sevenUp, quantity: 2, rate_minor: 60_000 },
        ];
        const noPhoto = await call('post', `${ord1}/receive`, { lines, paid_minor: 0, payment_mode: 'CASH' });
        expect(noPhoto.status).toBe(400);
        expect(noPhoto.body.message).toBe('Add at least one delivery photo to receive');
        await photo(ord1);
        expect((await call('post', `${ord1}/receive`, { lines, paid_minor: 100_001, payment_mode: 'CASH' })).status).toBe(400);
        expect((await call('post', `${ord1}/receive`, { lines: lines.map((l) => ({ ...l, receive: false })), paid_minor: 0, payment_mode: 'CASH' })).status).toBe(400);

        const first = await call('post', `${ord1}/receive`, { lines, paid_minor: 40_000, payment_mode: 'UPI' });
        expect(first.status).toBe(200);
        expect(first.body.status).toBe('ORDERED');
        expect(first.body.paid_minor).toBe(40_000);
        expect(first.body.lines.map((l: any) => [l.name, l.received])).toEqual([
          ['Chicken', true],
          ['7 Up Can 300 Ml', false],
        ]);
        expect(first.body.receipts).toEqual([
          expect.objectContaining({ total_minor: 100_000, paid_minor: 40_000, payment_mode: 'UPI', items: 1 }),
        ]);
        const inv1 = first.body.receipts[0].invoice_number as string;
        expect(inv1).toMatch(/^INV-ALP-\d{4}-\d{4}$/);
        expect(first.body.photos).toEqual([expect.objectContaining({ received: true })]);

        // Four more Kg of chicken at Alpha Main (it had none left).
        const grid = await inv('overview', { branch_id: branchA.id });
        expect(grid.body.items.find((i: any) => i.id === chicken).cells[branchA.id].stock).toBe(4);

        // A received line cannot change; the next delivery needs its own photo.
        expect((await call('patch', ord1, { lines: [{ id: chickenLine, item_id: chicken, quantity: 9, rate_minor: 1 }] })).status).toBe(400);
        const rest = [{ id: upLine, item_id: sevenUp, quantity: 2, rate_minor: 60_000, receive: true }];
        expect((await call('post', `${ord1}/receive`, { lines: rest, paid_minor: 0, payment_mode: 'CASH' })).status).toBe(400);
        await photo(ord1);
        const second = await call('post', `${ord1}/receive`, { lines: rest, paid_minor: 0, payment_mode: 'CASH' });
        expect(second.status).toBe(200);
        expect(second.body.status).toBe('RECEIVED');
        expect(second.body.may_edit).toBe(false);
        expect(second.body.receipts).toHaveLength(2);
        const n = (s: string) => Number(s.slice(-4));
        expect(n(second.body.receipts[1].invoice_number)).toBe(n(inv1) + 1);
        expect(second.body.receipts[1]).toMatchObject({ paid_minor: 0, payment_mode: null });

        const received = await orders({ vendor_id: vendorId, tab: 'received' });
        expect(received.body.orders.map((o: any) => [o.po_number, o.invoice_number, o.total_minor - o.paid_minor])).toEqual([
          ['ORD-1', second.body.receipts[1].invoice_number, 180_000],
        ]);
        expect((await call('post', `${ord1}/receive`, { lines: rest, paid_minor: 0, payment_mode: 'CASH' })).status).toBe(409);
        expect((await photo(ord1)).status).toBe(409);
      });

      it('PO-5. cancels an order nothing has arrived on; marks one sent; refuses the rest', async () => {
        const sent = await call('post', `${ord2}/sent`);
        expect(sent.status).toBe(200);
        expect(sent.body.whatsapp_sent_at).not.toBeNull();
        expect((await call('post', `${ord2}/cancel`, {}, tokenKeeperA)).status).toBe(403);
        const cancelled = await call('post', `${ord2}/cancel`);
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.status).toBe('CANCELLED');
        expect((await call('post', `${ord2}/cancel`)).status).toBe(409);
        expect((await call('post', `${ord1}/cancel`)).status).toBe(409);
        expect((await inv('purchase-orders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
        expect((await orders({ vendor_id: vendorId })).body.counts).toEqual({ all: 1, sent: 0, cancelled: 2 });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PII
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Data minimisation', () => {
    it('RP-34. queue reports carry no customer identity at all, for a caller without customers.view', async () => {
      const res = await data('queue.tokens');
      const body = JSON.stringify(res.body);

      expect(body).not.toContain('Priya');
      expect(body).not.toContain('+9190');
      // "Total Customers" (a headcount metric, not an identity) legitimately
      // says "customer" — what must never appear is the COLUMN that would
      // carry one, in the declared columns or in an actual row.
      expect(res.body.columns.map((c: { key: string }) => c.key)).not.toContain('customer_name');
      expect(res.body.columns.map((c: { key: string }) => c.key)).not.toContain('phone');
      expect(res.body.rows[0]).not.toHaveProperty('customer_name');
      expect(res.body.rows[0]).not.toHaveProperty('phone');
      expect(Object.keys(res.body.rows[0])).toEqual(
        expect.arrayContaining(['token_number', 'status', 'party_size']),
      );
    });

    it('RP-35. no report leaks credentials, tokens or contact details', async () => {
      for (const key of [
        'queue.summary',
        'queue.tokens',
        'banquet.bookings',
        'banquet.payments',
        'tasks.assignee',
      ]) {
        const body = JSON.stringify((await data(key)).body);
        expect(body).not.toMatch(/password|password_hash|accessToken|refresh|secret/i);
        expect(body).not.toContain('@test.com');
        expect(body).not.toContain('+919000000001');
      }
    });

    it('RP-36. the banquet report names the customer but not how to contact them', async () => {
      // The staff booking list already shows the name; the phone is never
      // needed to read a report.
      const body = (await data('banquet.bookings')).body;
      expect(body.rows[0].customer_name).toBe('Priya Sharma');
      expect(JSON.stringify(body)).not.toContain('+919000000001');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Export', () => {
    beforeEach(async () => {
      await purgeAuditLogs(prisma);
    });

    it('RP-37. exports an Excel workbook with a download filename', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/queue.tokens/export'))
        .query({ ...range, format: 'xlsx' })
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="queue.tokens_${KOLKATA_DAY}_${KOLKATA_DAY}.xlsx"`,
      );
      expect(res.body.subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('RP-38. exports a PDF', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/banquet.bookings/export'))
        .query({ ...range, format: 'pdf' })
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('RP-39. refuses an unsupported format', async () => {
      for (const format of ['csv', 'html', 'exe', '']) {
        const res = await asAnalyst(
          request(http).get('/api/v1/reports/queue.tokens/export'),
        ).query({ ...range, format });
        expect(res.status).toBe(400);
      }
    });

    it('RP-40. requires reports.export, not merely reports.view', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/queue.tokens/export'),
        tokenNoExportA,
        companyA.id,
        branchA.id,
      ).query({ ...range, format: 'xlsx' });
      expect(res.status).toBe(403);
    });

    it('RP-41. an export cannot reach a domain the caller may not read', async () => {
      const res = await as(
        request(http).get('/api/v1/reports/banquet.bookings/export'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      ).query({ ...range, format: 'xlsx' });
      expect(res.status).toBe(403);
    });

    it('RP-42. audits WHAT was exported and by whom, never the rows', async () => {
      await asAnalyst(request(http).get('/api/v1/reports/banquet.payments/export')).query({
        ...range,
        format: 'xlsx',
      });

      const logs = await prisma.auditLog.findMany({ where: { entity_type: 'REPORT_EXPORT' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        user_id: analystA.id,
        company_id: companyA.id,
        branch_id: branchA.id,
        entity_id: 'banquet.payments',
      });

      const payload = logs[0].payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        action: 'export_report',
        format: 'xlsx',
        from: KOLKATA_DAY,
        to: KOLKATA_DAY,
        row_count: 1,
      });
      // The audit trail records the act, not the data.
      expect(JSON.stringify(payload)).not.toContain('5000000');
      expect(JSON.stringify(payload)).not.toContain('Priya');
    });

    it('RP-43. writes no audit entry when the export is refused', async () => {
      await as(
        request(http).get('/api/v1/reports/banquet.bookings/export'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      ).query({ ...range, format: 'xlsx' });

      expect(await prisma.auditLog.count({ where: { entity_type: 'REPORT_EXPORT' } })).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Dashboard', () => {
    it('RP-44. returns every widget the caller may see in ONE request', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard'));
      expect(res.status).toBe(200);

      expect(res.body.widgets.map((w: any) => w.key)).toEqual([
        'banquet.overview',
        'queue.daily',
        'queue.overview',
        'queue.today',
        'tasks.open',
      ]);
      expect(res.body.branch_id).toBe(branchA.id);
      expect(res.body.timezone).toBe('Asia/Kolkata');
      for (const widget of res.body.widgets) {
        expect(widget.error).toBeUndefined();
        expect(Array.isArray(widget.metrics)).toBe(true);
      }
    });

    it('RP-45. hides a widget whose domain permission the caller lacks', async () => {
      const res = await as(
        request(http).get('/api/v1/dashboard'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      );
      expect(res.status).toBe(200);
      expect(res.body.widgets.map((w: any) => w.key)).toEqual(['queue.daily', 'queue.overview', 'queue.today']);
    });

    it('RP-46. widget figures are branch-scoped', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard'));
      const banquet = res.body.widgets.find((w: any) => w.key === 'banquet.overview');
      const outstanding = banquet.metrics.find((m: any) => m.key === 'outstanding_INR');

      expect(outstanding).toMatchObject({ value: 10_000_000, type: 'money', currency: 'INR' });

      const tasks = res.body.widgets.find((w: any) => w.key === 'tasks.open');
      expect(tasks.metrics.find((m: any) => m.key === 'open').value).toBe(1);
    });

    it('RP-47. marks live widgets so a date filter is not implied', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard'));
      expect(res.body.widgets.every((w: any) => typeof w.live === 'boolean')).toBe(true);
    });

    it('RP-48. leaks no PII through the dashboard', async () => {
      const body = JSON.stringify((await asAnalyst(request(http).get('/api/v1/dashboard'))).body);
      expect(body).not.toContain('Priya');
      expect(body).not.toContain('+919000000001');
      expect(body).not.toMatch(/password|secret/i);
    });

    const window = { from: '2026-03-09', to: '2026-03-10' };
    const widget = (body: any, key: string) => body.widgets.find((w: any) => w.key === key);
    const values = (w: any) => Object.fromEntries(w.metrics.map((m: any) => [m.key, m.value]));

    it('RP-62. queue.today carries the SRS KPI row: customers, waiting, seated and no-shows today', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard'));
      const today = widget(res.body, 'queue.today');
      expect(today.live).toBe(true);
      expect(today.metrics.map((m: any) => m.key)).toEqual([
        'total', 'waiting', 'called', 'adults', 'kids', 'seated', 'no_show', 'longest_wait',
      ]);
      // The fixture's tokens are on March dates, so nothing is "today".
      expect(values(today)).toMatchObject({ total: 0, no_show: 0, seated: 0 });
    });

    it('RP-63. queue.overview counts the selected window at this branch only', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard').query(window));
      expect(res.status).toBe(200);
      const overview = widget(res.body, 'queue.overview');
      expect(overview.live).toBe(false);
      // branchA: SEATED + NO_SHOW on 10 March, CANCELLED on 9 March. branchA2
      // and companyB hold look-alike tokens that must not be counted.
      expect(values(overview)).toEqual({ registered: 3, seated: 1, cancelled: 1, no_show: 1 });

      const tenth = await asAnalyst(request(http).get('/api/v1/dashboard').query({ from: KOLKATA_DAY, to: KOLKATA_DAY }));
      expect(values(widget(tenth.body, 'queue.overview'))).toEqual({ registered: 2, seated: 1, cancelled: 0, no_show: 1 });
    });

    it('RP-64. queue.daily returns every date in the window, zeroes included, and no customer data', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/dashboard').query({ from: '2026-03-08', to: '2026-03-10' }));
      const daily = widget(res.body, 'queue.daily');
      expect(daily.display).toBe('series');
      expect(daily.metrics).toEqual([]);
      expect(daily.series.keys.map((k: any) => k.key)).toEqual(['registered', 'seated', 'no_show', 'cancelled']);
      expect(daily.series.points).toEqual([
        { date: '2026-03-08', values: { registered: 0, seated: 0, no_show: 0, cancelled: 0 } },
        { date: '2026-03-09', values: { registered: 1, seated: 0, no_show: 0, cancelled: 1 } },
        { date: '2026-03-10', values: { registered: 2, seated: 1, no_show: 1, cancelled: 0 } },
      ]);
      expect(JSON.stringify(daily)).not.toMatch(/Priya|\+91|customer/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFORMANCE: ALL BRANCHES, DRILL-DOWN, OUTSTANDING, COMPLIANCE, PAGING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('All branches dashboard', () => {
    const all = (token: string, companyId?: string) => {
      const req = request(http).get('/api/v1/dashboard/all-branches').set('Authorization', `Bearer ${token}`);
      if (companyId) req.set('X-Company-ID', companyId);
      return req;
    };

    it('RP-55. sums counts and money across every branch the caller may open — and only those', async () => {
      const res = await all(tokenAnalystA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('all_branches');
      expect(res.body.branches.map((b: any) => b.name)).toEqual(['Alpha Main', 'Alpha Second']);

      const tasks = res.body.widgets.find((w: any) => w.key === 'tasks.open');
      expect(tasks.branches.map((b: any) => b.branch_name)).toEqual(['Alpha Main', 'Alpha Second']);
      const perBranchOpen = tasks.branches.map(
        (b: any) => b.metrics.find((m: any) => m.key === 'open').value as number,
      );
      expect(tasks.metrics.find((m: any) => m.key === 'open').value).toBe(
        perBranchOpen.reduce((a: number, b: number) => a + b, 0),
      );

      const banquet = res.body.widgets.find((w: any) => w.key === 'banquet.overview');
      expect(banquet.metrics.find((m: any) => m.key === 'outstanding_INR')).toMatchObject({
        value: 10_000_000,
        currency: 'INR',
      });

      // Averages, rates and durations are never added up across branches.
      for (const widget of res.body.widgets) {
        for (const metric of widget.metrics) {
          expect([widget.key, metric.key, ['number', 'money'].includes(metric.type)]).toEqual([
            widget.key,
            metric.key,
            true,
          ]);
        }
      }
      expect(JSON.stringify(res.body)).not.toContain(companyB.id);
    });

    it('RP-56. a caller with dashboard access at one branch sees that branch alone', async () => {
      const res = await all(tokenQueueOnlyA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.branches.map((b: any) => b.id)).toEqual([branchA.id]);
      expect(res.body.widgets.map((w: any) => w.key)).toEqual(['queue.daily', 'queue.overview', 'queue.today']);
    });

    it('RP-57. refuses without dashboard access anywhere, for a foreign company, and without a company', async () => {
      expect((await all(tokenPlainA, companyA.id)).status).toBe(403);
      expect((await all(tokenAnalystB, companyA.id)).status).toBe(403);
      expect((await all(tokenAnalystA)).status).toBe(400);
      expect((await request(http).get('/api/v1/dashboard/all-branches').set('X-Company-ID', companyA.id)).status).toBe(401);
    });

    it('RP-65. the queue overview matrix and daily chart add up branch by branch, never across companies', async () => {
      const res = await all(tokenAnalystA, companyA.id).query({ from: '2026-03-09', to: '2026-03-10' });
      expect(res.status).toBe(200);

      const overview = res.body.widgets.find((w: any) => w.key === 'queue.overview');
      const byBranch = Object.fromEntries(
        overview.branches.map((b: any) => [b.branch_name, Object.fromEntries(b.metrics.map((m: any) => [m.key, m.value]))]),
      );
      expect(byBranch['Alpha Main']).toEqual({ registered: 3, seated: 1, cancelled: 1, no_show: 1 });
      expect(byBranch['Alpha Second']).toEqual({ registered: 1, seated: 1, cancelled: 0, no_show: 0 });
      expect(Object.fromEntries(overview.metrics.map((m: any) => [m.key, m.value]))).toEqual({
        registered: 4,
        seated: 2,
        cancelled: 1,
        no_show: 1,
      });

      const daily = res.body.widgets.find((w: any) => w.key === 'queue.daily');
      expect(daily.series.points).toEqual([
        { date: '2026-03-09', values: { registered: 1, seated: 0, no_show: 0, cancelled: 1 } },
        { date: '2026-03-10', values: { registered: 3, seated: 2, no_show: 1, cancelled: 0 } },
      ]);
      expect(daily.branches.every((b: any) => Array.isArray(b.series.points))).toBe(true);
      // companyB's look-alike seated token on 10 March is not in any figure.
      expect(JSON.stringify(res.body)).not.toContain(companyB.id);
    });
  });

  describe('Drill-down, outstanding balances, compliance and paging', () => {
    it('RP-58. booking and payment rows carry the id their drill-down opens', async () => {
      const bookings = await data('banquet.bookings');
      expect(bookings.body.drilldown).toEqual({ id_key: 'booking_id', path: '/banquet/:id' });
      expect(bookings.body.rows[0].booking_id).toBe(bookingA.id);
      expect(bookings.body.branch_name).toBe('Alpha Main');

      const payments = await data('banquet.payments');
      expect(payments.body.rows[0].booking_id).toBe(bookingA.id);

      // A queue token has no screen of its own, so it offers no drill-down.
      expect((await data('queue.tokens')).body.drilldown).toBeNull();
    });

    it('RP-59. the outstanding report lists only live events that still owe, from the payment history', async () => {
      const settled = await prisma.banquetBooking.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          customer_id: bookingA.customer_id,
          hall_id: bookingA.hall_id,
          starts_at: new Date('2026-03-10T13:00:00.000Z'),
          ends_at: new Date('2026-03-10T16:00:00.000Z'),
          guest_count: 10,
          status: BanquetBookingStatus.CONFIRMED,
          package_name: 'Silver',
          price_per_guest_minor: 100,
          currency: 'INR',
          total_amount_minor: 1000,
        },
      });
      await prisma.banquetPayment.create({
        data: {
          booking_id: settled.id,
          company_id: companyA.id,
          branch_id: branchA.id,
          amount_minor: 1000,
          currency: 'INR',
          paid_at: new Date('2026-03-10T08:00:00.000Z'),
        },
      });

      const res = await data('banquet.outstanding');
      expect(res.status).toBe(200);
      expect(res.body.rows.map((r: any) => r.booking_id)).toEqual([bookingA.id]);
      expect(res.body.rows[0]).toMatchObject({
        total_amount_minor: 15_000_000,
        paid_amount_minor: 5_000_000,
        balance_minor: 10_000_000,
      });
      expect(res.body.metrics.find((m: any) => m.key === 'balance_INR').value).toBe(10_000_000);

      // Same domain rule as every banquet report.
      const refused = await as(
        request(http).get('/api/v1/reports/banquet.outstanding/data'),
        tokenQueueOnlyA,
        companyA.id,
        branchA.id,
      ).query(range);
      expect(refused.status).toBe(403);
    });

    it('RP-60. routine adherence separates on-time from late completion', async () => {
      const res = await data('tasks.routines');
      expect(res.status).toBe(200);
      expect(res.body.columns.map((c: any) => c.key)).toEqual(
        expect.arrayContaining(['on_time', 'late', 'missed']),
      );
      expect(res.body.metrics.map((m: any) => m.key)).toEqual(expect.arrayContaining(['late', 'on_time_rate']));
    });

    it('RP-61. refuses a page offset deeper than the cap', async () => {
      expect((await data('queue.tokens', { offset: 100_001 })).status).toBe(400);
      expect((await data('queue.tokens', { offset: 100_000 })).status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTENSIBILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Extensibility', () => {
    it('RP-49. every registered report came from its own domain module', () => {
      const registry = app.get(ReportRegistry);
      const domains = new Set(registry.definitions().map((d) => d.domain));
      expect([...domains].sort()).toEqual(['banquet', 'pos', 'purchase', 'queue', 'tasks']);
    });

    // The roadmap's later modules do not exist yet, and nothing here pretends
    // they do. (Point of sale and purchasing now have their own tables and
    // modules, so their reports are real — see "POS reports" and "Purchase
    // reports".)
    it('RP-50. invents no report for a module that does not exist', () => {
      const keys = app.get(ReportRegistry).definitions().map((d) => d.key);
      for (const absent of ['inventory', 'finance', 'sales']) {
        expect(keys.some((k) => k.startsWith(`${absent}.`))).toBe(false);
      }
    });

    it('RP-51. a new report registers without the engine changing', () => {
      const registry = app.get(ReportRegistry);
      const before = registry.definitions().length;

      registry.register({
        definition: {
          key: 'inventory.stock_movements',
          name: 'Stock movements',
          description: 'Registered by a module the engine has never heard of',
          domain: 'inventory',
          scope: 'branch',
          kind: 'rows',
          permission: 'queue.view',
          columns: [{ key: 'sku', label: 'SKU', type: 'string' }],
          exportable: true,
        },
        run: async () => ({ rows: [], total: 0 }),
      });

      expect(registry.definitions()).toHaveLength(before + 1);
      expect(registry.get('inventory.stock_movements')).toBeDefined();
    });

    it('RP-52. the dashboard holds exactly the widgets the domains registered', () => {
      expect(app.get(DashboardService).keys()).toEqual([
        'banquet.overview',
        'queue.daily',
        'queue.overview',
        'queue.today',
        'tasks.open',
      ]);
    });

    /**
     * The extensibility claim, proved over HTTP rather than asserted.
     *
     * `hall_id` is a filter key nothing in the reporting core has ever heard
     * of. If the request DTO named the filters it accepts, the global
     * forbidNonWhitelisted pipe would reject this with 400 before the registry
     * saw it — and "a future module registers a report without touching the
     * core" would be false.
     */
    it('RP-53. a newly registered report’s own filter survives the request pipeline', async () => {
      const seen: Array<Record<string, string>> = [];
      app.get(ReportRegistry).register({
        definition: {
          key: 'inventory.stock_on_hand',
          name: 'Stock on hand',
          description: 'Registered at runtime by a module the core does not know',
          domain: 'inventory',
          scope: 'branch',
          kind: 'rows',
          // A permission analystA holds, so the domain check is not what is
          // being measured here.
          permission: 'queue.view',
          columns: [{ key: 'sku', label: 'SKU', type: 'string' }],
          options: [{ key: 'hall_id', label: 'Location', values: ['main', 'cellar'] }],
          exportable: true,
        },
        run: async (query) => {
          seen.push({ ...query.options });
          return { rows: [{ sku: 'ABC-1' }], total: 1 };
        },
      });

      const accepted = await asAnalyst(
        request(http).get('/api/v1/reports/inventory.stock_on_hand/data'),
      ).query({ ...range, hall_id: 'cellar' });

      expect(accepted.status).toBe(200);
      expect(accepted.body.rows).toEqual([{ sku: 'ABC-1' }]);
      expect(accepted.body.filters.options).toEqual({ hall_id: 'cellar' });
      expect(seen).toEqual([{ hall_id: 'cellar' }]);
      // The catalogue advertises the new filter without any core change.
      expect(accepted.body.option_specs).toEqual([
        { key: 'hall_id', label: 'Location', values: ['main', 'cellar'] },
      ]);

      // Still an allow-list: a value the new report did not declare is refused.
      const refused = await asAnalyst(
        request(http).get('/api/v1/reports/inventory.stock_on_hand/data'),
      ).query({ ...range, hall_id: 'roof' });
      expect(refused.status).toBe(400);

      // And a filter no report declared is still refused, on every report.
      const unknown = await asAnalyst(
        request(http).get('/api/v1/reports/inventory.stock_on_hand/data'),
      ).query({ ...range, nonsense: 'x' });
      expect(unknown.status).toBe(400);
    });

    it('RP-54. refuses a repeated filter rather than silently using one value', async () => {
      const res = await asAnalyst(request(http).get('/api/v1/reports/queue.tokens/data')).query(
        `from=${KOLKATA_DAY}&to=${KOLKATA_DAY}&status=SEATED&status=NO_SHOW`,
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/single value/i);
    });
  });
});

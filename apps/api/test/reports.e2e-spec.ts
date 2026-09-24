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
      expect([...domains].sort()).toEqual(['banquet', 'queue', 'tasks']);
    });

    // The roadmap's later modules do not exist yet, and nothing here pretends
    // they do.
    it('RP-50. invents no report for a module that does not exist', () => {
      const keys = app.get(ReportRegistry).definitions().map((d) => d.key);
      for (const absent of ['pos', 'inventory', 'purchase', 'finance', 'sales']) {
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

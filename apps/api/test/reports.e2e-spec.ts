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
        'banquet.payments',
        'queue.summary',
        'queue.tokens',
        'tasks.assignee',
        'tasks.completion',
        'tasks.routines',
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
  // PII
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Data minimisation', () => {
    it('RP-34. queue reports carry no customer identity at all', async () => {
      const res = await data('queue.tokens');
      const body = JSON.stringify(res.body);

      expect(body).not.toContain('Priya');
      expect(body).not.toContain('+9190');
      expect(body).not.toMatch(/customer/i);
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
      expect(res.body.widgets.map((w: any) => w.key)).toEqual(['queue.today']);
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

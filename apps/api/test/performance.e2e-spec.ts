/**
 * NFR-04 — "dashboard and report under 3 s", measured rather than asserted from
 * reading the code.
 *
 * OPT-IN: runs only with SAMCO_PERF=1, because it seeds tens of thousands of
 * rows and takes minutes. The ordinary e2e run skips it.
 *
 * What it does
 *   - Seeds one company with three Asia/Kolkata branches: 120 days of queue
 *     tokens (300 a day at the busy branch, 100 at the others — 60,000 rows),
 *     6,000 tasks, and 720 confirmed banquet bookings with payments.
 *   - Times, through the real HTTP stack (in-process Nest app, supertest over a
 *     loopback socket, PostgreSQL on the same machine), 20 sequential calls per
 *     endpoint after 3 warm-ups, then 20 concurrent dashboard calls.
 *   - Prints p50 / p95 / max per endpoint as one `PERF {...}` JSON line each,
 *     and asserts p95 < 3000 ms for the dashboard and report endpoints.
 *
 * What it does NOT prove: behaviour on production hardware, over a network,
 * with a remote database, or with other tenants' load. The numbers are for
 * this machine and this data volume only.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { performance } from 'node:perf_hooks';
import { appendFileSync } from 'node:fs';
import { BranchStatus, CompanyStatus, MembershipStatus, QueueTokenStatus, TaskStatus } from '@samco/database';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';

const RUN = process.env.SAMCO_PERF === '1';
const PASSWORD = 'SecurePassword123!';
const TZ = 'Asia/Kolkata';
const DAYS = 120;
const SAMPLES = 20;
const WARMUPS = 3;
const TARGET_MS = 3000;

const PERMS = [
  'dashboard.view',
  'reports.view',
  'reports.export',
  'queue.view',
  'banquet.view',
  'tasks.view',
  'tasks.reports.view',
];

function branchToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/**
 * Every result goes to stdout and, when SAMCO_PERF_OUT names a file, is also
 * appended there as one JSON line — test reporters may hide console output.
 */
function record(kind: 'PERF' | 'PERF_SEED', result: object) {
  const line = `${kind} ${JSON.stringify(result)}`;
  console.log(line);
  if (process.env.SAMCO_PERF_OUT) appendFileSync(process.env.SAMCO_PERF_OUT, `${line}\n`);
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { n: sorted.length, p50: Math.round(at(50)), p95: Math.round(at(95)), max: Math.round(sorted[sorted.length - 1]) };
}

(RUN ? describe : describe.skip)('NFR-04 performance under seeded volume (opt-in)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;
  let token: string;
  let company: any;
  let busy: any;
  const today = branchToday();

  const as = (req: request.Test, branchId = busy.id) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', company.id).set('X-Branch-ID', branchId);

  async function chunked<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
    for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);
    const seedStarted = performance.now();

    company = await prisma.company.create({ data: { name: 'Perf Co', status: CompanyStatus.ACTIVE } });
    const branches = [];
    for (const name of ['Perf Busy', 'Perf Two', 'Perf Three']) {
      branches.push(await prisma.branch.create({ data: { company_id: company.id, name, timezone: TZ, status: BranchStatus.ACTIVE } }));
    }
    busy = branches[0];

    const perms = await prisma.permission.findMany({ where: { name: { in: PERMS } } });
    const role = await prisma.role.create({ data: { company_id: company.id, name: 'Analyst' } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })) });
    const user = await prisma.user.create({ data: { email: 'perf-analyst@test.com', password_hash: await bcrypt.hash(PASSWORD, 10) } });
    await prisma.companyMembership.create({ data: { user_id: user.id, company_id: company.id, status: MembershipStatus.ACTIVE } });
    await prisma.userBranchRole.createMany({ data: branches.map((b) => ({ user_id: user.id, branch_id: b.id, role_id: role.id })) });
    token = (await request(http).post('/api/v1/auth/login').send({ email: 'perf-analyst@test.com', password: PASSWORD })).body.accessToken;

    // ── Queue: 120 days × (300 | 100 | 100) tokens ────────────────────────────
    const statuses: QueueTokenStatus[] = ['SEATED', 'SEATED', 'SEATED', 'SEATED', 'SEATED', 'SEATED', 'SEATED', 'NO_SHOW', 'CANCELLED', 'WAITING'];
    for (const [index, branch] of branches.entries()) {
      const perDay = index === 0 ? 300 : 100;
      const rows = [];
      for (let d = 0; d < DAYS; d++) {
        const date = shift(today, -d);
        for (let n = 1; n <= perDay; n++) {
          const status = statuses[n % statuses.length];
          const created = new Date(Date.parse(`${date}T04:00:00.000Z`) + n * 60_000);
          const kids = n % 3 === 0 ? 1 : 0;
          rows.push({
            company_id: company.id,
            branch_id: branch.id,
            service_date: new Date(`${date}T00:00:00.000Z`),
            token_number: n,
            status,
            adults: 2,
            kids,
            party_size: 2 + kids,
            created_at: created,
            called_at: status === 'SEATED' || status === 'NO_SHOW' ? new Date(created.getTime() + 20 * 60_000) : null,
            seated_at: status === 'SEATED' ? new Date(created.getTime() + 30 * 60_000) : null,
            no_show_at: status === 'NO_SHOW' ? new Date(created.getTime() + 40 * 60_000) : null,
            cancelled_at: status === 'CANCELLED' ? new Date(created.getTime() + 10 * 60_000) : null,
          });
        }
      }
      await chunked(rows, 5000, (chunk) => prisma.queueToken.createMany({ data: chunk }));
    }

    // ── Tasks: 120 days × 50 at the busy branch ────────────────────────────────
    const taskStatuses: TaskStatus[] = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'PENDING', 'IN_PROGRESS', 'CANCELLED'];
    const tasks = [];
    for (let d = 0; d < DAYS; d++) {
      const date = shift(today, -d);
      for (let n = 0; n < 50; n++) {
        const status = taskStatuses[n % taskStatuses.length];
        const created = new Date(Date.parse(`${date}T03:00:00.000Z`) + n * 60_000);
        tasks.push({
          company_id: company.id,
          branch_id: busy.id,
          title: `Perf task ${d}-${n}`,
          status,
          created_at: created,
          due_at: new Date(created.getTime() + 4 * 3_600_000),
          completed_at: status === 'COMPLETED' ? new Date(created.getTime() + (n % 2 ? 5 : 3) * 3_600_000) : null,
          started_at: status === 'IN_PROGRESS' || status === 'COMPLETED' ? new Date(created.getTime() + 3_600_000) : null,
          cancelled_at: status === 'CANCELLED' ? new Date(created.getTime() + 3_600_000) : null,
        });
      }
    }
    await chunked(tasks, 5000, (chunk) => prisma.task.createMany({ data: chunk }));

    // ── Banquet: 3 halls × 120 days × 2 non-overlapping services ─────────────
    const halls = [];
    for (const name of ['Crystal', 'Emerald', 'Ruby']) {
      halls.push(await prisma.banquetHall.create({ data: { branch_id: busy.id, name, capacity: 300 } }));
    }
    const customers = [];
    for (let i = 0; i < 50; i++) {
      customers.push(await prisma.customer.create({ data: { company_id: company.id, name: `Perf customer ${i}` } }));
    }
    const bookings = [];
    let i = 0;
    for (let d = 0; d < DAYS; d++) {
      const date = shift(today, -d + 30);
      for (const hall of halls) {
        for (const [start, end] of [['06:30', '09:30'], ['12:30', '16:30']]) {
          const total = 150 * 90_000;
          bookings.push({
            company_id: company.id,
            branch_id: busy.id,
            customer_id: customers[i++ % customers.length].id,
            hall_id: hall.id,
            hall_name: hall.name,
            starts_at: new Date(`${date}T${start}:00.000Z`),
            ends_at: new Date(`${date}T${end}:00.000Z`),
            guest_count: 150,
            status: 'CONFIRMED' as const,
            package_name: 'Perf buffet',
            price_per_guest_minor: 90_000,
            currency: 'INR',
            total_amount_minor: total,
            paid_minor: total / 2,
            confirmed_at: new Date(`${date}T00:00:00.000Z`),
          });
        }
      }
    }
    await chunked(bookings, 1000, (chunk) => prisma.banquetBooking.createMany({ data: chunk }));
    const created = await prisma.banquetBooking.findMany({ where: { branch_id: busy.id }, select: { id: true, starts_at: true, total_amount_minor: true } });
    const payments = created.map((b) => ({
      booking_id: b.id,
      company_id: company.id,
      branch_id: busy.id,
      amount_minor: b.total_amount_minor / 2,
      currency: 'INR',
      paid_at: new Date(b.starts_at.getTime() - 7 * 86_400_000),
      kind: 'ADVANCE' as const,
    }));
    await chunked(payments, 1000, (chunk) => prisma.banquetPayment.createMany({ data: chunk }));

    const counts = {
      queue_tokens: await prisma.queueToken.count(),
      tasks: await prisma.task.count(),
      banquet_bookings: await prisma.banquetBooking.count(),
      banquet_payments: await prisma.banquetPayment.count(),
      seed_ms: Math.round(performance.now() - seedStarted),
    };
    record('PERF_SEED', counts);
    await prisma.$executeRawUnsafe('ANALYZE');
  }, 600_000);

  afterAll(async () => {
    if (!prisma) return;
    await resetDatabase(prisma);
    await app.close();
  }, 600_000);

  async function measure(name: string, build: () => request.Test, expectStatus = 200) {
    for (let w = 0; w < WARMUPS; w++) {
      const res = await build();
      expect(res.status, `${name} warm-up`).toBe(expectStatus);
    }
    const samples: number[] = [];
    for (let s = 0; s < SAMPLES; s++) {
      const started = performance.now();
      const res = await build();
      samples.push(performance.now() - started);
      expect(res.status, name).toBe(expectStatus);
    }
    const result = { endpoint: name, ...stats(samples) };
    record('PERF', result);
    return result;
  }

  const q90 = () => ({ from: shift(today, -89), to: today });

  it('PF-1. dashboard, default 30 days, busy branch', async () => {
    const r = await measure('GET /dashboard (30 days)', () => as(request(http).get('/api/v1/dashboard')));
    expect(r.p95).toBeLessThan(TARGET_MS);
  }, 300_000);

  it('PF-2. dashboard, 90 days, busy branch', async () => {
    const r = await measure('GET /dashboard (90 days)', () => as(request(http).get('/api/v1/dashboard').query(q90())));
    expect(r.p95).toBeLessThan(TARGET_MS);
  }, 300_000);

  it('PF-3. dashboard, All branches, 30 days', async () => {
    const r = await measure('GET /dashboard/all-branches (30 days)', () =>
      request(http).get('/api/v1/dashboard/all-branches').set('Authorization', `Bearer ${token}`).set('X-Company-ID', company.id),
    );
    expect(r.p95).toBeLessThan(TARGET_MS);
  }, 300_000);

  it('PF-4. reports over 90 days: queue summary, token rows (first and a deep page), outstanding, task completion', async () => {
    const results = [
      await measure('GET /reports/queue.summary/data (90 days)', () =>
        as(request(http).get('/api/v1/reports/queue.summary/data').query(q90())),
      ),
      await measure('GET /reports/queue.tokens/data (90 days, first page)', () =>
        as(request(http).get('/api/v1/reports/queue.tokens/data').query({ ...q90(), limit: 50, offset: 0 })),
      ),
      await measure('GET /reports/queue.tokens/data (90 days, offset 20000)', () =>
        as(request(http).get('/api/v1/reports/queue.tokens/data').query({ ...q90(), limit: 50, offset: 20_000 })),
      ),
      await measure('GET /reports/banquet.outstanding/data (90 days)', () =>
        as(request(http).get('/api/v1/reports/banquet.outstanding/data').query(q90())),
      ),
      await measure('GET /reports/tasks.completion/data (90 days)', () =>
        as(request(http).get('/api/v1/reports/tasks.completion/data').query(q90())),
      ),
    ];
    for (const r of results) expect(r.p95, r.endpoint).toBeLessThan(TARGET_MS);
  }, 600_000);

  it('PF-5. a 14-day Excel export of 4,200 token rows (recorded, not held to the 3 s target)', async () => {
    await measure('GET /reports/queue.tokens/export xlsx (14 days, 4,200 rows)', () =>
      as(request(http).get('/api/v1/reports/queue.tokens/export'))
        .query({ from: shift(today, -13), to: today, format: 'xlsx' })
        .responseType('blob'),
    );
  }, 600_000);

  it('PF-6. twenty concurrent dashboard requests', async () => {
    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      const timings = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const started = performance.now();
          const res = await as(request(http).get('/api/v1/dashboard'));
          expect(res.status).toBe(200);
          return performance.now() - started;
        }),
      );
      samples.push(...timings);
    }
    const result = { endpoint: 'GET /dashboard × 20 concurrent (5 rounds)', ...stats(samples) };
    record('PERF', result);
    expect(result.p95).toBeLessThan(TARGET_MS);
  }, 600_000);
});

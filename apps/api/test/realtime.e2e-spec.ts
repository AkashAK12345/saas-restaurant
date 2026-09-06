/**
 * T0-B — Real-time infrastructure.
 *
 *   staff:    JWT + branch RBAC  → POST /realtime/tickets/<channel> → ticket
 *   display:  credential header  → POST /display/stream-tickets     → ticket
 *   both:     GET /realtime/stream?ticket=…  (SSE)
 *
 * Tickets are short-lived and single-use; the stream scope comes only from the
 * consumed ticket. These tests read real SSE bytes over a listening socket.
 */

// Tuned BEFORE the app boots. Only this spec's forked process sees them.
process.env.SSE_HEARTBEAT_MS = '150';
process.env.STREAM_TICKET_TTL_MS = '1500';

import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { EVENT_BROKER, type EventBroker } from '../src/common/realtime/event-broker.js';
import { RealtimeChannel } from '../src/common/realtime/channels.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { MembershipStatus, CompanyStatus, BranchStatus } from '@samco/database';

const PASSWORD = 'SecurePassword123!';

// ─── tiny SSE reader ─────────────────────────────────────────────────────────

interface SseFrame { id?: string; event?: string; data?: string; comment?: string }

function openSse(port: number, path: string, headers: Record<string, string> = {}) {
  const frames: SseFrame[] = [];
  let status = 0;
  let buffer = '';
  const req = http.request(
    { host: '127.0.0.1', port, path, method: 'GET', headers: { Accept: 'text/event-stream', ...headers } },
    (res) => {
      status = res.statusCode ?? 0;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const f: SseFrame = {};
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) f.comment = line.slice(1).trim();
            else if (line.startsWith('id:')) f.id = line.slice(3).trim();
            else if (line.startsWith('event:')) f.event = line.slice(6).trim();
            else if (line.startsWith('data:')) f.data = (f.data ?? '') + line.slice(5).trim();
          }
          if (f.event || f.data || f.id || f.comment) frames.push(f);
        }
      });
    },
  );
  // close() destroys the socket, which surfaces as an 'error' (ECONNRESET /
  // aborted) on the request. Without a listener Node treats that as an
  // unhandled error and vitest fails the run even though every test passed.
  req.on('error', () => undefined);
  req.end();
  const waitFor = (pred: () => boolean, ms = 2_000) =>
    new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (pred()) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error('timeout waiting for SSE condition'));
        setTimeout(tick, 15);
      };
      tick();
    });
  return {
    frames,
    status: () => status,
    waitFor,
    close: () => req.destroy(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── suite ───────────────────────────────────────────────────────────────────

describe('T0-B Real-time (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let broker: EventBroker;
  let http_: any;
  let port: number;

  let companyA: any, companyB: any;
  let branchA: any, branchA2: any, branchB: any;
  let kdsStaffA: any;
  let queueTokenA: string, kdsTokenA: string, noStreamTokenA: string, tokenB: string;
  let customerDevice: any, chefDevice: any;

  const withCtx = (req: request.Test, token: string, companyId: string, branchId?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    if (branchId) req.set('X-Branch-ID', branchId);
    return req;
  };
  const staffTicket = (channel: string, token: string, companyId: string, branchId: string) =>
    withCtx(request(http_).post(`/api/v1/realtime/tickets/${channel}`), token, companyId, branchId);
  const deviceTicket = (credential: string, branchId: string, channel: string) =>
    request(http_)
      .post('/api/v1/display/stream-tickets')
      .set('Authorization', `Display ${credential}`)
      .set('X-Branch-ID', branchId)
      .send({ channel });
  const scope = (companyId: string, branchId: string, channel = RealtimeChannel.QUEUE) => ({ companyId, branchId, channel });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    prisma = app.get(PrismaService);
    broker = app.get(EVENT_BROKER);
    http_ = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);
    const hash = await bcrypt.hash(PASSWORD, 10);

    companyA = await prisma.company.create({ data: { name: 'RT Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'RT Beta', status: CompanyStatus.ACTIVE } });
    branchA = await prisma.branch.create({ data: { company_id: companyA.id, name: 'A1', timezone: 'UTC', status: BranchStatus.ACTIVE } });
    branchA2 = await prisma.branch.create({ data: { company_id: companyA.id, name: 'A2', timezone: 'UTC', status: BranchStatus.ACTIVE } });
    branchB = await prisma.branch.create({ data: { company_id: companyB.id, name: 'B1', timezone: 'UTC', status: BranchStatus.ACTIVE } });

    const perm = async (name: string) => (await prisma.permission.findUnique({ where: { name } }))!.id;
    const P = {
      queue: await perm('queue.view'),
      kds: await perm('banquet.kds.view'),
      tasks: await perm('tasks.view'),
      devCreate: await perm('display_devices.create'),
      devRevoke: await perm('display_devices.revoke'),
      custView: await perm('customers.view'),
    };

    const mk = async (email: string, companyId: string, branchId: string, permIds: string[], roleName: string) => {
      const role = await prisma.role.create({ data: { company_id: companyId, name: roleName } });
      if (permIds.length) await prisma.rolePermission.createMany({ data: permIds.map((p) => ({ role_id: role.id, permission_id: p })) });
      const user = await prisma.user.create({ data: { email, password_hash: hash } });
      await prisma.companyMembership.create({ data: { user_id: user.id, company_id: companyId, status: MembershipStatus.ACTIVE } });
      await prisma.userBranchRole.create({ data: { user_id: user.id, branch_id: branchId, role_id: role.id } });
      const token = (await request(http_).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.accessToken;
      return { user, token };
    };

    ({ token: queueTokenA } = await mk('rt-queue-a@test.com', companyA.id, branchA.id, [P.queue, P.tasks, P.devCreate, P.devRevoke], 'QueueOps'));
    ({ user: kdsStaffA, token: kdsTokenA } = await mk('rt-kds-a@test.com', companyA.id, branchA.id, [P.kds], 'Kitchen'));
    ({ token: noStreamTokenA } = await mk('rt-none-a@test.com', companyA.id, branchA.id, [P.custView], 'Clerk'));
    ({ token: tokenB } = await mk('rt-queue-b@test.com', companyB.id, branchB.id, [P.queue, P.kds, P.tasks], 'QueueOpsB'));

    // Devices at branchA, paired by queueStaffA (holds display_devices.create at branchA).
    customerDevice = (await withCtx(request(http_).post('/api/v1/display-devices'), queueTokenA, companyA.id, branchA.id)
      .send({ name: 'Lobby', kind: 'QUEUE_CUSTOMER' })).body;
    chefDevice = (await withCtx(request(http_).post('/api/v1/display-devices'), queueTokenA, companyA.id, branchA.id)
      .send({ name: 'Kitchen', kind: 'BANQUET_CHEF' })).body;
    expect(customerDevice.credential).toBeDefined();
    expect(chefDevice.credential).toBeDefined();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    // Any stream a test left open would keep server.close() waiting forever.
    (app.getHttpServer() as http.Server).closeAllConnections?.();
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAFF TICKETS — full RBAC chain applies at mint
  // ═══════════════════════════════════════════════════════════════════════════

  describe('staff tickets', () => {
    it('ST-1. authorized staff mint a ticket bound to their branch and channel', async () => {
      const res = await staffTicket('queue', queueTokenA, companyA.id, branchA.id);
      expect(res.status).toBe(201);
      expect(res.body.ticket).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body).toMatchObject({ channel: 'queue', branch_id: branchA.id });
      expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('ST-2. per-channel permission: queue staff cannot mint banquet-kds; kds staff cannot mint queue', async () => {
      expect((await staffTicket('banquet-kds', queueTokenA, companyA.id, branchA.id)).status).toBe(403);
      expect((await staffTicket('queue', kdsTokenA, companyA.id, branchA.id)).status).toBe(403);
      expect((await staffTicket('banquet-kds', kdsTokenA, companyA.id, branchA.id)).status).toBe(201);
      expect((await staffTicket('tasks', queueTokenA, companyA.id, branchA.id)).status).toBe(201);
    });

    it('ST-3. staff with no stream permission cannot mint anything', async () => {
      for (const ch of ['queue', 'banquet-kds', 'tasks']) {
        expect((await staffTicket(ch, noStreamTokenA, companyA.id, branchA.id)).status).toBe(403);
      }
    });

    it('ST-4. BRANCH isolation: no role at branchA2 → 403; X-Branch-ID is a claim, not proof', async () => {
      expect((await staffTicket('queue', queueTokenA, companyA.id, branchA2.id)).status).toBe(403);
    });

    it('ST-5. COMPANY isolation: A staff cannot mint for company B, nor claim B\'s branch under A', async () => {
      expect((await staffTicket('queue', queueTokenA, companyB.id, branchB.id)).status).toBe(403);
      expect((await staffTicket('queue', queueTokenA, companyA.id, branchB.id)).status).toBe(403);
    });

    it('ST-5b. ...while B staff mint for B normally, and are equally locked out of A', async () => {
      const own = await staffTicket('queue', tokenB, companyB.id, branchB.id);
      expect(own.status).toBe(201);
      expect(own.body.branch_id).toBe(branchB.id);
      expect((await staffTicket('queue', tokenB, companyA.id, branchA.id)).status).toBe(403);
      expect((await staffTicket('queue', tokenB, companyB.id, branchA.id)).status).toBe(403);
    });

    it('ST-6. unauthenticated / missing context → 401 / 403; unknown channel route → 404', async () => {
      expect((await request(http_).post('/api/v1/realtime/tickets/queue')).status).toBe(401);
      expect((await withCtx(request(http_).post('/api/v1/realtime/tickets/queue'), queueTokenA, companyA.id)).status).toBe(403);
      expect((await staffTicket('everything', queueTokenA, companyA.id, branchA.id)).status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPLAY TICKETS — credential in header, channel restricted by kind
  // ═══════════════════════════════════════════════════════════════════════════

  describe('display tickets', () => {
    it('DT-1. a device mints a ticket for a channel its kind allows', async () => {
      const res = await deviceTicket(customerDevice.credential, branchA.id, 'queue');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ channel: 'queue', branch_id: branchA.id });
      expect(res.body.ticket).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(res.body)).not.toContain(customerDevice.credential.split('.')[1]);
    });

    it('DT-2. WRONG KIND: a queue display cannot get banquet-kds; a chef board cannot get queue or tasks', async () => {
      expect((await deviceTicket(customerDevice.credential, branchA.id, 'banquet-kds')).status).toBe(403);
      expect((await deviceTicket(chefDevice.credential, branchA.id, 'queue')).status).toBe(403);
      expect((await deviceTicket(chefDevice.credential, branchA.id, 'tasks')).status).toBe(403);
      expect((await deviceTicket(chefDevice.credential, branchA.id, 'banquet-kds')).status).toBe(201);
    });

    it('DT-3. invalid channel → 400; credential for the wrong branch → 401; no credential → 401', async () => {
      expect((await deviceTicket(customerDevice.credential, branchA.id, 'nope')).status).toBe(400);
      expect((await deviceTicket(customerDevice.credential, branchA2.id, 'queue')).status).toBe(401);
      expect((await deviceTicket(customerDevice.credential, branchB.id, 'queue')).status).toBe(401);
      expect((await request(http_).post('/api/v1/display/stream-tickets').set('X-Branch-ID', branchA.id).send({ channel: 'queue' })).status).toBe(401);
    });

    it('DT-4. a staff JWT cannot mint a display ticket', async () => {
      const res = await request(http_)
        .post('/api/v1/display/stream-tickets')
        .set('Authorization', `Bearer ${queueTokenA}`)
        .set('X-Branch-ID', branchA.id)
        .send({ channel: 'queue' });
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THE STREAM
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SSE stream', () => {
    it('SS-1. a valid staff ticket opens a stream and receives events for its scope', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`);
      await sse.waitFor(() => sse.status() === 200);
      await sse.waitFor(() => broker.subscriberCount(scope(companyA.id, branchA.id)) === 1);

      broker.publish(scope(companyA.id, branchA.id), 'demo.event', { hello: 'world' });
      await sse.waitFor(() => sse.frames.some((f) => f.event === 'demo.event'));

      const f = sse.frames.find((f) => f.event === 'demo.event')!;
      expect(f.id).toBe('1');
      expect(JSON.parse(f.data!)).toMatchObject({ data: { hello: 'world' } });
      sse.close();
      await sse.waitFor(() => broker.subscriberCount(scope(companyA.id, branchA.id)) === 0);
    });

    it('SS-2. ISOLATION: a branchA subscriber never sees branchA2, companyB, or another channel', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`);
      await sse.waitFor(() => broker.subscriberCount(scope(companyA.id, branchA.id)) === 1);

      broker.publish(scope(companyA.id, branchA2.id), 'leak.branch', 1);
      broker.publish(scope(companyB.id, branchB.id), 'leak.company', 1);
      broker.publish(scope(companyB.id, branchA.id), 'leak.company-same-branch-id', 1);
      broker.publish(scope(companyA.id, branchA.id, RealtimeChannel.TASKS), 'leak.channel', 1);
      broker.publish(scope(companyA.id, branchA.id), 'mine', 1);

      await sse.waitFor(() => sse.frames.some((f) => f.event === 'mine'));
      const events = sse.frames.map((f) => f.event).filter((e) => e && e !== 'heartbeat');
      expect(events).toEqual(['mine']);
      sse.close();
    });

    it('SS-3. a display ticket streams only its own scope', async () => {
      const { ticket } = (await deviceTicket(customerDevice.credential, branchA.id, 'queue')).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`);
      await sse.waitFor(() => sse.status() === 200);
      await sse.waitFor(() => broker.subscriberCount(scope(companyA.id, branchA.id)) === 1);

      broker.publish(scope(companyA.id, branchA2.id), 'not.mine', 1);
      broker.publish(scope(companyA.id, branchA.id), 'display.mine', 1);
      await sse.waitFor(() => sse.frames.some((f) => f.event === 'display.mine'));
      expect(sse.frames.some((f) => f.event === 'not.mine')).toBe(false);
      sse.close();
    });

    it('SS-4. HEARTBEAT arrives on an idle stream as a comment frame with no id', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`);
      await sse.waitFor(() => sse.frames.filter((f) => f.comment === 'heartbeat').length >= 2, 3_000);
      const hbs = sse.frames.filter((f) => f.comment === 'heartbeat');
      // Comment-only: no id, no event, no data — so the client's Last-Event-ID
      // is never disturbed and EventSource fires no handler.
      for (const hb of hbs) {
        expect(hb.id).toBeUndefined();
        expect(hb.event).toBeUndefined();
        expect(hb.data).toBeUndefined();
      }
      // And a real event published afterwards still carries the broker id, not
      // a Nest-invented counter that would have been inflated by heartbeats.
      const ev = broker.publish(scope(companyA.id, branchA.id), 'after.heartbeats', 1);
      await sse.waitFor(() => sse.frames.some((f) => f.event === 'after.heartbeats'));
      expect(sse.frames.find((f) => f.event === 'after.heartbeats')!.id).toBe(String(ev.id));
      sse.close();
    });

    it('SS-5. RECONNECT: Last-Event-ID replays only missed events from the same scope', async () => {
      const s = scope(companyA.id, branchA.id);
      const tasksScope = scope(companyA.id, branchA.id, RealtimeChannel.TASKS);
      // Ids are per-scope and other tests may already have published here, so
      // take them from the publish results rather than assuming a fresh scope.
      const e1 = broker.publish(tasksScope, 't.1', 1);
      const e2 = broker.publish(tasksScope, 't.2', 2);
      const e3 = broker.publish(tasksScope, 't.3', 3);
      broker.publish(s, 'q.other-channel', 0); // must not appear in the tasks replay

      const { ticket } = (await staffTicket('tasks', queueTokenA, companyA.id, branchA.id)).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`, { 'Last-Event-ID': String(e1.id) });
      await sse.waitFor(() => sse.frames.filter((f) => f.event?.startsWith('t.')).length >= 2);
      const replayed = sse.frames.filter((f) => f.event?.startsWith('t.')).map((f) => [f.id, f.event]);
      expect(replayed).toEqual([[String(e2.id), 't.2'], [String(e3.id), 't.3']]);
      expect(sse.frames.some((f) => f.event === 'q.other-channel')).toBe(false);
      sse.close();
    });

    it('SS-6. a garbage Last-Event-ID is harmless', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const sse = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`, { 'Last-Event-ID': 'not-a-number' });
      await sse.waitFor(() => sse.status() === 200);
      broker.publish(scope(companyA.id, branchA.id), 'after.garbage', 1);
      await sse.waitFor(() => sse.frames.some((f) => f.event === 'after.garbage'));
      sse.close();
    });

    it('SS-7. DISCONNECT releases the subscription — no leak', async () => {
      const s = scope(companyA.id, branchA.id);
      // Earlier tests' streams close asynchronously; wait for a clean baseline.
      const settle = openSse(port, '/api/v1/realtime/stream?ticket=none'); // 401, just for waitFor
      await settle.waitFor(() => broker.subscriberCount(s) === 0, 3_000);
      settle.close();

      const conns = [];
      for (let i = 0; i < 3; i++) {
        const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
        conns.push(openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`));
      }
      await conns[0].waitFor(() => broker.subscriberCount(s) === 3);
      conns.forEach((c) => c.close());
      await conns[0].waitFor(() => broker.subscriberCount(s) === 0, 3_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TICKET SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ticket security', () => {
    const connect = (query: string, headers: Record<string, string> = {}) =>
      request(http_).get(`/api/v1/realtime/stream${query}`).set(headers);

    it('TS-1. SINGLE USE: a ticket cannot open a second stream', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const first = openSse(port, `/api/v1/realtime/stream?ticket=${ticket}`);
      await first.waitFor(() => first.status() === 200);
      const second = await connect(`?ticket=${ticket}`);
      expect(second.status).toBe(401);
      first.close();
    });

    it('TS-2. the X-Stream-Ticket header path works, and the ticket is single-use there too', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      const first = openSse(port, '/api/v1/realtime/stream', { 'X-Stream-Ticket': ticket });
      await first.waitFor(() => first.status() === 200);
      expect((await connect('', { 'X-Stream-Ticket': ticket })).status).toBe(401);
      expect((await connect(`?ticket=${ticket}`)).status).toBe(401);
      first.close();
    });

    it('TS-3. EXPIRED ticket is rejected', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      await sleep(1_600); // TTL is 1500 ms in this spec
      expect((await connect(`?ticket=${ticket}`)).status).toBe(401);
    });

    it('TS-4. invalid / malformed / missing tickets are rejected generically', async () => {
      for (const q of ['', '?ticket=', '?ticket=abc', `?ticket=${'0'.repeat(64)}`, `?ticket=${'z'.repeat(64)}`]) {
        const res = await connect(q);
        expect(res.status, q).toBe(401);
        expect(res.body.message).toBe('Invalid stream ticket');
      }
    });

    it('TS-5. the long-lived DISPLAY credential is NOT accepted as a stream ticket', async () => {
      expect((await connect(`?ticket=${customerDevice.credential}`)).status).toBe(401);
      expect((await connect(`?ticket=${customerDevice.credential.split('.')[1]}`)).status).toBe(401);
      expect((await connect('', { Authorization: `Display ${customerDevice.credential}`, 'X-Branch-ID': branchA.id })).status).toBe(401);
    });

    it('TS-6. a staff JWT is NOT accepted as a stream ticket', async () => {
      expect((await connect(`?ticket=${queueTokenA}`)).status).toBe(401);
      expect((await connect('', { Authorization: `Bearer ${queueTokenA}`, 'X-Company-ID': companyA.id, 'X-Branch-ID': branchA.id })).status).toBe(401);
    });

    it('TS-7. REVOKED DEVICE: a ticket minted before revocation is refused at connect', async () => {
      const dev = (await withCtx(request(http_).post('/api/v1/display-devices'), queueTokenA, companyA.id, branchA.id)
        .send({ name: 'Doomed', kind: 'QUEUE_CUSTOMER' })).body;
      const { ticket } = (await deviceTicket(dev.credential, branchA.id, 'queue')).body;
      await withCtx(request(http_).post(`/api/v1/display-devices/${dev.device.id}/revoke`), queueTokenA, companyA.id, branchA.id).expect(200);
      expect((await connect(`?ticket=${ticket}`)).status).toBe(401);
      // ...and the revoked device can no longer mint at all.
      expect((await deviceTicket(dev.credential, branchA.id, 'queue')).status).toBe(401);
    });

    it('TS-8. STAFF whose role is removed between mint and connect is refused', async () => {
      const { ticket } = (await staffTicket('banquet-kds', kdsTokenA, companyA.id, branchA.id)).body;
      const roles = await prisma.userBranchRole.findMany({ where: { user_id: kdsStaffA.id } });
      await prisma.userBranchRole.deleteMany({ where: { user_id: kdsStaffA.id } });
      try {
        expect((await connect(`?ticket=${ticket}`)).status).toBe(401);
      } finally {
        await prisma.userBranchRole.createMany({ data: roles.map((r) => ({ user_id: r.user_id, branch_id: r.branch_id, role_id: r.role_id })) });
      }
    });

    it('TS-9. an INACTIVE branch refuses both mint and connect', async () => {
      const { ticket } = (await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).body;
      await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.INACTIVE } });
      try {
        expect((await connect(`?ticket=${ticket}`)).status).toBe(401);
        expect((await staffTicket('queue', queueTokenA, companyA.id, branchA.id)).status).toBe(403);
        expect((await deviceTicket(customerDevice.credential, branchA.id, 'queue')).status).toBe(401);
      } finally {
        await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.ACTIVE } });
      }
    });

    it('TS-10. no secret material in any ticket/stream response', async () => {
      const staff = await staffTicket('queue', queueTokenA, companyA.id, branchA.id);
      const dev = await deviceTicket(customerDevice.credential, branchA.id, 'queue');
      for (const body of [staff.body, dev.body]) {
        const raw = JSON.stringify(body);
        expect(raw).not.toContain(queueTokenA);
        expect(raw).not.toContain(customerDevice.credential);
        expect(raw).not.toMatch(/credential_hash|password|secret/i);
        expect(Object.keys(body).sort()).toEqual(['branch_id', 'channel', 'expires_at', 'ticket']);
      }
      const bad = await connect('?ticket=nope');
      expect(JSON.stringify(bad.body)).not.toMatch(/stack|prisma/i);
    });
  });
});

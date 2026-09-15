/**
 * Plate approval (SRS §5.3.5) — service staff ask the kitchen for plates of a
 * dish; someone else in the kitchen approves or rejects; approved plates are
 * dispatched.
 *
 * Fixture:
 *   companyA ─ branchA  ─ server   (banquet.view + banquet.plate.request)
 *            │          ├ chef     (banquet.kds.view + banquet.kds.manage)
 *            │          ├ headChef (banquet.kds.view + banquet.kds.manage + banquet.plate.request)
 *            │          └ viewer   (banquet.view + banquet.kds.view)
 *            └ branchA2 ─ (a confirmed booking of its own)
 *   companyB ─ branchB  ─ chefB    (banquet.kds.view + banquet.kds.manage)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { BranchStatus, CompanyStatus, MembershipStatus } from '@samco/database';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { EVENT_BROKER, type EventBroker } from '../src/common/realtime/event-broker.js';
import { RealtimeChannel } from '../src/common/realtime/channels.js';
import { BANQUET_EVENT_TYPES } from '../src/modules/banquet/banquet-bookings.service.js';

const PASSWORD = 'SecurePassword123!';
/** 20 March 2027 in Kolkata; the event starts 19:00 local. */
const EVENT_DAY = '2027-03-20';

describe('Banquet plate approval (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let broker: EventBroker;
  let http: any;

  let companyA: any, companyB: any, branchA: any, branchA2: any, branchB: any;
  let server: any, chef: any, headChef: any;
  let tokens: Record<'server' | 'chef' | 'headChef' | 'viewer' | 'chefB', string>;
  let booking: any, draft: any, otherBranchBooking: any, dish: any, otherDish: any;

  const as = (req: request.Test, token: string, companyId = companyA.id, branchId = branchA.id) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId).set('X-Branch-ID', branchId);
  const url = (p: string) => `/api/v1/banquet${p}`;

  const ask = (plates = 20, token = tokens.server, bookingId = booking.id, itemId = dish.id) =>
    as(request(http).post(url(`/bookings/${bookingId}/plate-requests`)), token).send({ item_id: itemId, plates, note: 'Table 4 refill' });
  const act = (id: string, verb: 'approve' | 'reject' | 'dispatch', token = tokens.chef, body: object = {}) =>
    as(request(http).post(url(`/kds/plate-requests/${id}/${verb}`)), token).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    broker = app.get(EVENT_BROKER);
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);
    const hash = await bcrypt.hash(PASSWORD, 10);

    companyA = await prisma.company.create({ data: { name: 'Plates Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Plates Beta', status: CompanyStatus.ACTIVE } });
    const branch = (company_id: string, name: string) =>
      prisma.branch.create({ data: { company_id, name, timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA = await branch(companyA.id, 'Alpha Main');
    branchA2 = await branch(companyA.id, 'Alpha Second');
    branchB = await branch(companyB.id, 'Beta Main');

    const perms = await prisma.permission.findMany();
    const id = (n: string) => {
      const p = perms.find((x) => x.name === n);
      if (!p) throw new Error(`permission ${n} not seeded`);
      return p.id;
    };
    const role = async (company_id: string, name: string, keys: string[]) => {
      const r = await prisma.role.create({ data: { company_id, name } });
      await prisma.rolePermission.createMany({ data: keys.map((k) => ({ role_id: r.id, permission_id: id(k) })) });
      return r;
    };
    const serverRole = await role(companyA.id, 'Server', ['banquet.view', 'banquet.plate.request']);
    const chefRole = await role(companyA.id, 'Chef', ['banquet.kds.view', 'banquet.kds.manage']);
    const headRole = await role(companyA.id, 'Head chef', ['banquet.kds.view', 'banquet.kds.manage', 'banquet.plate.request']);
    const viewerRole = await role(companyA.id, 'Viewer', ['banquet.view', 'banquet.kds.view']);
    const chefRoleB = await role(companyB.id, 'Chef', ['banquet.kds.view', 'banquet.kds.manage']);

    const person = async (email: string, first: string, company_id: string, branch_id: string, role_id: string) => {
      const u = await prisma.user.create({ data: { email, password_hash: hash, first_name: first } });
      await prisma.companyMembership.create({ data: { user_id: u.id, company_id, status: MembershipStatus.ACTIVE } });
      await prisma.userBranchRole.create({ data: { user_id: u.id, branch_id, role_id } });
      return u;
    };
    server = await person('pl-server@test.com', 'Sam', companyA.id, branchA.id, serverRole.id);
    chef = await person('pl-chef@test.com', 'Kabir', companyA.id, branchA.id, chefRole.id);
    headChef = await person('pl-head@test.com', 'Hema', companyA.id, branchA.id, headRole.id);
    await person('pl-viewer@test.com', 'Vik', companyA.id, branchA.id, viewerRole.id);
    await person('pl-chef-b@test.com', 'Bea', companyB.id, branchB.id, chefRoleB.id);

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.accessToken as string;
    tokens = {
      server: await login('pl-server@test.com'),
      chef: await login('pl-chef@test.com'),
      headChef: await login('pl-head@test.com'),
      viewer: await login('pl-viewer@test.com'),
      chefB: await login('pl-chef-b@test.com'),
    };

    const customer = await prisma.customer.create({ data: { company_id: companyA.id, name: 'Priya Secret', phone: '+919800011111' } });
    const hall = await prisma.banquetHall.create({ data: { branch_id: branchA.id, name: 'Crystal', capacity: 200 } });
    const hall2 = await prisma.banquetHall.create({ data: { branch_id: branchA2.id, name: 'Other', capacity: 200 } });
    const makeBooking = (branch_id: string, hall_id: string, status: 'CONFIRMED' | 'DRAFT', hour: number) =>
      prisma.banquetBooking.create({
        data: {
          company_id: companyA.id,
          branch_id,
          customer_id: customer.id,
          hall_id,
          hall_name: 'Crystal',
          starts_at: new Date(`${EVENT_DAY}T${String(hour).padStart(2, '0')}:30:00.000Z`),
          ends_at: new Date(`${EVENT_DAY}T${String(hour + 3).padStart(2, '0')}:30:00.000Z`),
          guest_count: 120,
          status,
          package_name: 'Buffet',
          price_per_guest_minor: 90_000,
          currency: 'INR',
          total_amount_minor: 10_800_000,
          items: { create: [{ name: 'Paneer Tikka', position: 0 }, { name: 'Gulab Jamun', position: 1 }] },
        },
        include: { items: { orderBy: { position: 'asc' } } },
      });
    booking = await makeBooking(branchA.id, hall.id, 'CONFIRMED', 13);
    draft = await makeBooking(branchA.id, hall.id, 'DRAFT', 5);
    otherBranchBooking = await makeBooking(branchA2.id, hall2.id, 'CONFIRMED', 13);
    dish = booking.items[0];
    otherDish = otherBranchBooking.items[0];
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('PL-1. request → approve → dispatch, each step audited and pushed to the kitchen without customer data', async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const sub = broker
      .subscribe({ companyId: companyA.id, branchId: branchA.id, channel: RealtimeChannel.BANQUET_KDS })
      .subscribe((e) => events.push({ type: e.type, data: e.data }));
    try {
      const created = await ask(20);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        status: 'REQUESTED',
        plates: 20,
        note: 'Table 4 refill',
        item: { id: dish.id, name: 'Paneer Tikka' },
        hall_name: 'Crystal',
        requested_by: { id: server.id, name: 'Sam' },
        decided_by: null,
      });

      const approved = await act(created.body.id, 'approve');
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', decided_by: { id: chef.id, name: 'Kabir' } });

      const dispatched = await act(created.body.id, 'dispatch');
      expect(dispatched.status).toBe(200);
      expect(dispatched.body.status).toBe('DISPATCHED');
      expect(dispatched.body.dispatched_at).toBeTruthy();

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'BANQUET_PLATE_REQUEST', entity_id: created.body.id },
        orderBy: { created_at: 'asc' },
      });
      expect(audits.map((a) => (a.payload as any).action)).toEqual(['request_plates', 'approve_plates', 'dispatch_plates']);
      expect(audits.every((a) => a.company_id === companyA.id && a.branch_id === branchA.id)).toBe(true);

      const mine = events.filter((e) => e.type === BANQUET_EVENT_TYPES.PLATE_REQUEST_UPDATED);
      expect(mine.map((e) => (e.data as any).status)).toEqual(['REQUESTED', 'APPROVED', 'DISPATCHED']);
      expect(JSON.stringify(mine)).not.toMatch(/Priya|\+91|INR|price/);
    } finally {
      sub.unsubscribe();
    }
  });

  it('PL-2. nobody decides their own request — not through the API and not in the database', async () => {
    const own = await ask(5, tokens.headChef);
    expect(own.status).toBe(201);
    expect((await act(own.body.id, 'approve', tokens.headChef)).status).toBe(403);
    expect((await act(own.body.id, 'reject', tokens.headChef, { reason: 'mine' })).status).toBe(403);

    await expect(
      prisma.banquetPlateRequest.update({
        where: { id: own.body.id },
        data: { status: 'APPROVED', decided_by_user_id: headChef.id, decided_at: new Date() },
      }),
    ).rejects.toThrow(/banquet_plate_requests_not_self_decided/);

    // Someone else in the kitchen may.
    expect((await act(own.body.id, 'approve', tokens.chef)).status).toBe(200);
  });

  it('PL-3. a rejection needs a reason, and ends the request', async () => {
    const created = await ask(8);
    expect((await act(created.body.id, 'reject', tokens.chef, {})).status).toBe(400);
    expect((await act(created.body.id, 'reject', tokens.chef, { reason: '   ' })).status).toBe(400);
    const rejected = await act(created.body.id, 'reject', tokens.chef, { reason: 'Kitchen is out of paneer' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejection_reason: 'Kitchen is out of paneer' });
    expect((await act(created.body.id, 'approve')).status).toBe(409);
    expect((await act(created.body.id, 'dispatch')).status).toBe(409);
  });

  it('PL-4. illegal moves are 409s: dispatch before approval, approve twice', async () => {
    const created = await ask(3);
    expect((await act(created.body.id, 'dispatch')).status).toBe(409);
    expect((await act(created.body.id, 'approve')).status).toBe(200);
    const again = await act(created.body.id, 'approve');
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/APPROVED to APPROVED/);
  });

  it('PL-5. two cooks deciding at once: exactly one wins, the other is a controlled conflict', async () => {
    const created = await ask(12);
    const [a, b] = await Promise.all([
      act(created.body.id, 'approve', tokens.chef),
      act(created.body.id, 'reject', tokens.headChef, { reason: 'No' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await prisma.banquetPlateRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(['APPROVED', 'REJECTED']).toContain(row.status);
  });

  it('PL-6. only a confirmed event takes requests, only for its own dishes, within limits', async () => {
    expect((await ask(10, tokens.server, draft.id, draft.items[0].id)).status).toBe(409);
    expect((await ask(10, tokens.server, booking.id, draft.items[0].id)).status).toBe(422);
    expect((await ask(0)).status).toBe(400);
    expect((await ask(10_001)).status).toBe(400);
    expect(
      (await as(request(http).post(url(`/bookings/${booking.id}/plate-requests`)), tokens.server).send({ item_id: dish.id, plates: 2.5 })).status,
    ).toBe(400);
    await expect(
      prisma.banquetPlateRequest.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          booking_id: booking.id,
          item_id: dish.id,
          plates: 0,
          requested_by_user_id: server.id,
        },
      }),
    ).rejects.toThrow(/banquet_plate_requests_plates_range/);
  });

  it('PL-7. permissions: a server cannot decide, a chef cannot ask, a viewer can do neither', async () => {
    const created = await ask(4);
    expect((await act(created.body.id, 'approve', tokens.server)).status).toBe(403);
    expect((await ask(4, tokens.chef)).status).toBe(403);
    expect((await ask(4, tokens.viewer)).status).toBe(403);
    expect((await act(created.body.id, 'approve', tokens.viewer)).status).toBe(403);
    expect((await request(http).post(url(`/kds/plate-requests/${created.body.id}/approve`))).status).toBe(401);
  });

  it('PL-8. another branch or company cannot see or touch a request, whatever the headers claim', async () => {
    const created = await ask(6);
    // Same company, a branch where the chef holds no role.
    expect((await as(request(http).post(url(`/kds/plate-requests/${created.body.id}/approve`)), tokens.chef, companyA.id, branchA2.id).send()).status).toBe(403);
    // Another company's chef, naming their own branch.
    expect((await as(request(http).post(url(`/kds/plate-requests/${created.body.id}/approve`)), tokens.chefB, companyB.id, branchB.id).send()).status).toBe(404);
    // Another company's chef, naming ours.
    expect((await as(request(http).post(url(`/kds/plate-requests/${created.body.id}/approve`)), tokens.chefB, companyA.id, branchA.id).send()).status).toBe(403);
    // A dish from another branch's booking is not found from this branch.
    expect((await ask(6, tokens.server, otherBranchBooking.id, otherDish.id)).status).toBe(404);
    const row = await prisma.banquetPlateRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe('REQUESTED');
  });

  it('PL-9. the kitchen list is the branch day, with no customer and no money; the booking list needs banquet.view', async () => {
    const list = await as(request(http).get(url('/kds/plate-requests')), tokens.chef).query({ service_date: EVENT_DAY });
    expect(list.status).toBe(200);
    expect(list.body.service_date).toBe(EVENT_DAY);
    expect(list.body.requests.length).toBeGreaterThan(0);
    expect(list.body.requests.every((r: any) => r.booking_id === booking.id)).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/Priya|\+91|price|total|INR/);

    const nextDay = await as(request(http).get(url('/kds/plate-requests')), tokens.chef).query({ service_date: '2027-03-21' });
    expect(nextDay.body.requests).toEqual([]);
    expect((await as(request(http).get(url('/kds/plate-requests')), tokens.chef).query({ service_date: '2027-02-30' })).status).toBe(400);
    expect((await as(request(http).get(url('/kds/plate-requests')), tokens.server)).status).toBe(403);

    const forBooking = await as(request(http).get(url(`/bookings/${booking.id}/plate-requests`)), tokens.server);
    expect(forBooking.status).toBe(200);
    expect(forBooking.body.length).toBe(list.body.requests.length);
    expect((await as(request(http).get(url(`/bookings/${booking.id}/plate-requests`)), tokens.chef)).status).toBe(403);
    expect((await as(request(http).get(url(`/bookings/${otherBranchBooking.id}/plate-requests`)), tokens.server)).status).toBe(404);
  });
});

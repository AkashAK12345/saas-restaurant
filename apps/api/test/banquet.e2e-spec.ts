/**
 * Phase 8 — Banquet Management.
 *
 * Fixture:
 *   companyA ─ branchA   ─ managerA  (all banquet perms)
 *            │           ├ viewerA   (banquet.view + banquet.kds.view only)
 *            │           └ strangerA (no banquet perms)
 *            ├ branchA2  (managerA holds no role here)
 *            └ branchOff (INACTIVE)  ─ managerA holds the role
 *   companyB ─ branchB   ─ managerB
 *   companyS (SUSPENDED) ─ branchS   ─ suspendedUser
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
import { BANQUET_EVENT_TYPES } from '../src/modules/banquet/banquet-bookings.service.js';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const MANAGER_PERMS = [
  'banquet.view',
  'banquet.hall.manage',
  'banquet.package.manage',
  'banquet.booking.create',
  'banquet.booking.update',
  'banquet.booking.confirm',
  'banquet.booking.cancel',
  'banquet.booking.complete',
  'banquet.payment.create',
  'banquet.event_plan.manage',
  'banquet.kds.view',
  'banquet.kds.manage',
  'customers.view',
  'customers.create',
  'display_devices.create',
];
const VIEWER_PERMS = ['banquet.view', 'banquet.kds.view'];

/** A far-future window keeps every test's bookings clear of each other. */
let clock = Date.UTC(2027, 0, 10, 6, 0, 0);
function nextWindow(hours = 4): { starts_at: string; ends_at: string } {
  clock += 24 * 60 * 60 * 1000; // a fresh day per call
  const start = new Date(clock);
  const end = new Date(clock + hours * 60 * 60 * 1000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

describe('Phase 8 Banquet Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let broker: EventBroker;
  let http: any;

  let companyA: any, companyB: any, companyS: any;
  let branchA: any, branchA2: any, branchOff: any, branchB: any, branchS: any;
  let managerA: any, viewerA: any, strangerA: any, managerB: any, suspendedUser: any;
  let tokenManagerA: string, tokenViewerA: string, tokenStrangerA: string;
  let tokenManagerB: string, tokenSuspended: string;
  let customerA: any, customerB: any;
  let hallA: any, hallSmall: any, hallOff: any, hallA2: any;
  let packageA: any, packageB: any, packageOff: any;

  const as = (req: request.Test, token: string, companyId: string, branchId?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    if (branchId) req.set('X-Branch-ID', branchId);
    return req;
  };
  const asManager = (req: request.Test, branchId = branchA.id) =>
    as(req, tokenManagerA, companyA.id, branchId);

  const createBooking = (over: Record<string, unknown> = {}, branchId = branchA.id) =>
    asManager(request(http).post('/api/v1/banquet/bookings'), branchId).send({
      customer_id: customerA.id,
      hall_id: hallA.id,
      package_id: packageA.id,
      guest_count: 80,
      ...nextWindow(),
      ...over,
    });

  const confirmed = async (over: Record<string, unknown> = {}) => {
    const res = await createBooking(over);
    expect(res.status).toBe(201);
    const ok = await asManager(
      request(http).post(`/api/v1/banquet/bookings/${res.body.id}/confirm`),
    ).send();
    expect(ok.status).toBe(200);
    return ok.body;
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

    companyA = await prisma.company.create({ data: { name: 'Banquet Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Banquet Beta', status: CompanyStatus.ACTIVE } });
    companyS = await prisma.company.create({ data: { name: 'Banquet Suspended', status: CompanyStatus.SUSPENDED } });

    branchA = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Main', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA2 = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Second', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchOff = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Closed', timezone: 'UTC', status: BranchStatus.INACTIVE } });
    branchB = await prisma.branch.create({ data: { company_id: companyB.id, name: 'Beta Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });
    branchS = await prisma.branch.create({ data: { company_id: companyS.id, name: 'Suspended Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });

    const perms = await prisma.permission.findMany({ where: { name: { in: MANAGER_PERMS } } });
    expect(perms).toHaveLength(MANAGER_PERMS.length); // seed sanity: Phase 8 keys exist
    const byName = new Map(perms.map((p) => [p.name, p.id]));

    const managerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Banquet Manager' } });
    const viewerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Banquet Viewer' } });
    const strangerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'No Banquet' } });
    const managerRoleB = await prisma.role.create({ data: { company_id: companyB.id, name: 'Banquet Manager' } });
    const managerRoleS = await prisma.role.create({ data: { company_id: companyS.id, name: 'Banquet Manager' } });

    await prisma.rolePermission.createMany({
      data: [
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleA.id, permission_id: byName.get(n)! })),
        ...VIEWER_PERMS.map((n) => ({ role_id: viewerRoleA.id, permission_id: byName.get(n)! })),
        { role_id: strangerRoleA.id, permission_id: byName.get('customers.view')! },
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleB.id, permission_id: byName.get(n)! })),
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleS.id, permission_id: byName.get(n)! })),
      ],
    });

    managerA = await prisma.user.create({ data: { email: 'b-manager-a@test.com', password_hash: hash } });
    viewerA = await prisma.user.create({ data: { email: 'b-viewer-a@test.com', password_hash: hash } });
    strangerA = await prisma.user.create({ data: { email: 'b-stranger-a@test.com', password_hash: hash } });
    managerB = await prisma.user.create({ data: { email: 'b-manager-b@test.com', password_hash: hash } });
    suspendedUser = await prisma.user.create({ data: { email: 'b-suspended@test.com', password_hash: hash } });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: managerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: viewerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: strangerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: managerB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: suspendedUser.id, company_id: companyS.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: managerA.id, branch_id: branchA.id, role_id: managerRoleA.id },
        { user_id: managerA.id, branch_id: branchOff.id, role_id: managerRoleA.id },
        { user_id: viewerA.id, branch_id: branchA.id, role_id: viewerRoleA.id },
        { user_id: strangerA.id, branch_id: branchA.id, role_id: strangerRoleA.id },
        { user_id: managerB.id, branch_id: branchB.id, role_id: managerRoleB.id },
        { user_id: suspendedUser.id, branch_id: branchS.id, role_id: managerRoleS.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body
        .accessToken as string;
    tokenManagerA = await login('b-manager-a@test.com');
    tokenViewerA = await login('b-viewer-a@test.com');
    tokenStrangerA = await login('b-stranger-a@test.com');
    tokenManagerB = await login('b-manager-b@test.com');
    tokenSuspended = await login('b-suspended@test.com');

    customerA = await prisma.customer.create({ data: { company_id: companyA.id, name: 'Meera Iyer', phone: '+919812300001' } });
    customerB = await prisma.customer.create({ data: { company_id: companyB.id, name: 'Other Co Customer' } });

    hallA = await prisma.banquetHall.create({ data: { branch_id: branchA.id, name: 'Crystal', capacity: 200 } });
    hallSmall = await prisma.banquetHall.create({ data: { branch_id: branchA.id, name: 'Emerald', capacity: 40 } });
    hallOff = await prisma.banquetHall.create({ data: { branch_id: branchA.id, name: 'Closed Room', capacity: 100, status: 'INACTIVE' } });
    hallA2 = await prisma.banquetHall.create({ data: { branch_id: branchA2.id, name: 'Other Branch Hall', capacity: 100 } });

    packageA = await prisma.banquetPackage.create({
      data: {
        company_id: companyA.id,
        name: 'Gold Veg',
        price_per_guest_minor: 125_000,
        currency: 'INR',
        items: { create: [{ name: 'Paneer Tikka', position: 0 }, { name: 'Dal Makhani', position: 1 }] },
      },
    });
    packageB = await prisma.banquetPackage.create({
      data: { company_id: companyB.id, name: 'Other Co Package', price_per_guest_minor: 1000, currency: 'USD' },
    });
    packageOff = await prisma.banquetPackage.create({
      data: { company_id: companyA.id, name: 'Retired', price_per_guest_minor: 1000, currency: 'INR', status: 'INACTIVE' },
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HALLS & PACKAGES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Halls', () => {
    it('BH-1. creates, reads and updates a branch-scoped hall', async () => {
      const created = await asManager(request(http).post('/api/v1/banquet/halls')).send({
        name: `Ruby-${Date.now()}`,
        capacity: 120,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ branch_id: branchA.id, capacity: 120, status: 'ACTIVE' });

      const read = await asManager(request(http).get(`/api/v1/banquet/halls/${created.body.id}`));
      expect(read.status).toBe(200);

      const updated = await asManager(
        request(http).patch(`/api/v1/banquet/halls/${created.body.id}`),
      ).send({ capacity: 150, status: 'INACTIVE' });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ capacity: 150, status: 'INACTIVE' });
    });

    it('BH-2. rejects a duplicate hall name at the same branch', async () => {
      const res = await asManager(request(http).post('/api/v1/banquet/halls')).send({
        name: 'Crystal',
        capacity: 50,
      });
      expect(res.status).toBe(409);
    });

    it('BH-3. validates capacity and rejects unknown fields', async () => {
      for (const body of [
        { name: 'X', capacity: 0 },
        { name: 'X', capacity: -5 },
        { name: 'X', capacity: 2.5 },
        { name: '', capacity: 10 },
        { name: 'X', capacity: 10, status: 'ACTIVE' }, // status is not client-settable at creation
        { name: 'X', capacity: 10, branch_id: branchB.id },
      ]) {
        const res = await asManager(request(http).post('/api/v1/banquet/halls')).send(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
    });

    it('BH-4. a hall of another branch is 404, and listing is branch-scoped', async () => {
      const cross = await asManager(request(http).get(`/api/v1/banquet/halls/${hallA2.id}`));
      expect(cross.status).toBe(404);

      const list = await asManager(request(http).get('/api/v1/banquet/halls')).query({ limit: 100 });
      expect(list.status).toBe(200);
      list.body.data.forEach((h: any) => expect(h.branch_id).toBe(branchA.id));
      expect(list.body.data.map((h: any) => h.id)).not.toContain(hallA2.id);
    });
  });

  describe('Packages', () => {
    it('BP-1. creates a company-scoped package with components and integer money', async () => {
      const res = await asManager(request(http).post('/api/v1/banquet/packages')).send({
        name: `Silver-${Date.now()}`,
        description: 'Vegetarian, 8 courses',
        price_per_guest_minor: 99_950,
        currency: 'INR',
        items: [{ name: 'Soup' }, { name: 'Biryani' }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        company_id: companyA.id,
        price_per_guest_minor: 99_950,
        currency: 'INR',
        status: 'ACTIVE',
      });
      expect(res.body.items.map((i: any) => [i.name, i.position])).toEqual([
        ['Soup', 0],
        ['Biryani', 1],
      ]);
    });

    it('BP-2. rejects non-integer money and bad currency codes', async () => {
      for (const body of [
        { name: 'A', price_per_guest_minor: 10.5, currency: 'INR' },
        { name: 'A', price_per_guest_minor: -1, currency: 'INR' },
        { name: 'A', price_per_guest_minor: '1000', currency: 'INR' },
        { name: 'A', price_per_guest_minor: 1000, currency: 'inr' },
        { name: 'A', price_per_guest_minor: 1000, currency: 'RUPEES' },
        { name: 'A', price_per_guest_minor: 1000, currency: '₹' },
        { name: 'A', price_per_guest_minor: 1000 },
      ]) {
        const res = await asManager(request(http).post('/api/v1/banquet/packages')).send(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
    });

    it('BP-3. is company-scoped: another company\'s package is 404 and never listed', async () => {
      const cross = await asManager(request(http).get(`/api/v1/banquet/packages/${packageB.id}`));
      expect(cross.status).toBe(404);

      const list = await asManager(request(http).get('/api/v1/banquet/packages')).query({ limit: 100 });
      expect(list.body.data.map((p: any) => p.id)).not.toContain(packageB.id);
      list.body.data.forEach((p: any) => expect(p.company_id).toBe(companyA.id));
    });

    it('BP-4. replaces the component list wholesale on update', async () => {
      const created = await asManager(request(http).post('/api/v1/banquet/packages')).send({
        name: `Repl-${Date.now()}`,
        price_per_guest_minor: 1000,
        currency: 'INR',
        items: [{ name: 'Old A' }, { name: 'Old B' }],
      });
      const updated = await asManager(
        request(http).patch(`/api/v1/banquet/packages/${created.body.id}`),
      ).send({ items: [{ name: 'New Only' }] });
      expect(updated.status).toBe(200);
      expect(updated.body.items.map((i: any) => i.name)).toEqual(['New Only']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKINGS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bookings', () => {
    it('BB-1. creates a DRAFT with a full commercial and component snapshot', async () => {
      const res = await createBooking({ guest_count: 80 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        company_id: companyA.id,
        branch_id: branchA.id,
        status: 'DRAFT',
        guest_count: 80,
        package_name: 'Gold Veg',
        price_per_guest_minor: 125_000,
        currency: 'INR',
        total_amount_minor: 10_000_000, // 125000 × 80
        confirmed_at: null,
      });
      expect(res.body.items.map((i: any) => i.name)).toEqual(['Paneer Tikka', 'Dal Makhani']);
      expect(res.body.items.every((i: any) => i.kds_status === 'PENDING')).toBe(true);
      expect(res.body.balance).toEqual({
        currency: 'INR',
        total_amount_minor: 10_000_000,
        paid_minor: 0,
        balance_minor: 10_000_000,
        fully_paid: false,
      });
    });

    it('BB-2. editing the package afterwards does not change an existing booking', async () => {
      const booking = await createBooking();
      const before = booking.body.total_amount_minor;

      const bumped = await asManager(request(http).patch(`/api/v1/banquet/packages/${packageA.id}`)).send({
        price_per_guest_minor: 200_000,
      });
      expect(bumped.status).toBe(200);

      const after = await asManager(request(http).get(`/api/v1/banquet/bookings/${booking.body.id}`));
      expect(after.body.price_per_guest_minor).toBe(125_000);
      expect(after.body.total_amount_minor).toBe(before);
      expect(after.body.package_name).toBe('Gold Veg');

      // restore for the remaining tests
      await asManager(request(http).patch(`/api/v1/banquet/packages/${packageA.id}`)).send({
        price_per_guest_minor: 125_000,
      });
    });

    it('BB-3. rejects a cross-company customer/package and a cross-branch hall', async () => {
      const wrongCustomer = await createBooking({ customer_id: customerB.id });
      expect(wrongCustomer.status).toBe(404);
      expect(JSON.stringify(wrongCustomer.body)).not.toContain('Other Co Customer');

      const wrongPackage = await createBooking({ package_id: packageB.id });
      expect(wrongPackage.status).toBe(404);

      const wrongHall = await createBooking({ hall_id: hallA2.id });
      expect(wrongHall.status).toBe(404);
    });

    it('BB-4. rejects an inactive hall, an inactive package, and an over-capacity party', async () => {
      expect((await createBooking({ hall_id: hallOff.id })).status).toBe(409);
      expect((await createBooking({ package_id: packageOff.id })).status).toBe(409);
      expect((await createBooking({ hall_id: hallSmall.id, guest_count: 80 })).status).toBe(409);
      // ...and the same hall is fine for a party it can seat
      expect((await createBooking({ hall_id: hallSmall.id, guest_count: 40 })).status).toBe(201);
    });

    it('BB-5. validates the event window', async () => {
      const w = nextWindow();
      const reversed = await createBooking({ starts_at: w.ends_at, ends_at: w.starts_at });
      expect(reversed.status).toBe(400);

      const zero = await createBooking({ starts_at: w.starts_at, ends_at: w.starts_at });
      expect(zero.status).toBe(400);

      const bad = await createBooking({ starts_at: 'tomorrow' });
      expect(bad.status).toBe(400);
    });

    it('BB-6. rejects a client-supplied status or total', async () => {
      for (const extra of [{ status: 'CONFIRMED' }, { total_amount_minor: 1 }, { currency: 'USD' }]) {
        const res = await createBooking(extra);
        expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
      }
    });

    it('BB-7. drafts may be edited and re-price from the snapshot; other states may not', async () => {
      const draft = await createBooking({ guest_count: 80 });
      const edited = await asManager(
        request(http).patch(`/api/v1/banquet/bookings/${draft.body.id}`),
      ).send({ guest_count: 100 });
      expect(edited.status).toBe(200);
      expect(edited.body.guest_count).toBe(100);
      expect(edited.body.total_amount_minor).toBe(12_500_000);

      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send();
      const late = await asManager(
        request(http).patch(`/api/v1/banquet/bookings/${draft.body.id}`),
      ).send({ guest_count: 120 });
      expect(late.status).toBe(409);
    });

    it('BB-8. lists with filters, scoped to the branch', async () => {
      const list = await asManager(request(http).get('/api/v1/banquet/bookings')).query({
        status: 'CONFIRMED',
        limit: 100,
      });
      expect(list.status).toBe(200);
      list.body.data.forEach((b: any) => {
        expect(b.branch_id).toBe(branchA.id);
        expect(b.status).toBe('CONFIRMED');
      });
    });

    it('BB-9. a booking of another branch or company is 404', async () => {
      const mine = await createBooking();
      const otherBranch = await as(
        request(http).get(`/api/v1/banquet/bookings/${mine.body.id}`),
        tokenManagerA,
        companyA.id,
        branchA2.id,
      );
      expect(otherBranch.status).toBe(403); // no role at branchA2 at all

      const otherCompany = await as(
        request(http).get(`/api/v1/banquet/bookings/${mine.body.id}`),
        tokenManagerB,
        companyB.id,
        branchB.id,
      );
      expect(otherCompany.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Booking lifecycle', () => {
    it('BL-1. DRAFT -> CONFIRMED -> COMPLETED', async () => {
      const draft = await createBooking();
      const conf = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`),
      ).send();
      expect(conf.status).toBe(200);
      expect(conf.body.status).toBe('CONFIRMED');
      expect(conf.body.confirmed_at).not.toBeNull();

      const done = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/complete`),
      ).send();
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.completed_at).not.toBeNull();
    });

    it('BL-2. cancellation works from DRAFT and from CONFIRMED', async () => {
      const draft = await createBooking();
      const c1 = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/cancel`),
      ).send();
      expect(c1.status).toBe(200);
      expect(c1.body.status).toBe('CANCELLED');

      const booking = await confirmed();
      const c2 = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${booking.id}/cancel`),
      ).send();
      expect(c2.status).toBe(200);
      expect(c2.body.status).toBe('CANCELLED');
    });

    it('BL-3. a draft cannot skip confirmation', async () => {
      const draft = await createBooking();
      const res = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/complete`),
      ).send();
      expect(res.status).toBe(409);
      const after = await prisma.banquetBooking.findUnique({ where: { id: draft.body.id } });
      expect(after!.status).toBe('DRAFT');
    });

    it('BL-4. terminal states are terminal', async () => {
      const booking = await confirmed();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/complete`)).send();
      for (const op of ['confirm', 'complete', 'cancel']) {
        const res = await asManager(
          request(http).post(`/api/v1/banquet/bookings/${booking.id}/${op}`),
        ).send();
        expect([op, res.status]).toEqual([op, 409]);
      }

      const cancelled = await createBooking();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${cancelled.body.id}/cancel`)).send();
      for (const op of ['confirm', 'complete', 'cancel']) {
        const res = await asManager(
          request(http).post(`/api/v1/banquet/bookings/${cancelled.body.id}/${op}`),
        ).send();
        expect([op, res.status]).toEqual([op, 409]);
      }
    });

    it('BL-5. repeating an operation is rejected the second time', async () => {
      const draft = await createBooking();
      const first = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`),
      ).send();
      const second = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`),
      ).send();
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
    });

    it('BL-6. there is NO route that mutates status directly', async () => {
      const draft = await createBooking();
      const patch = await asManager(
        request(http).patch(`/api/v1/banquet/bookings/${draft.body.id}`),
      ).send({ status: 'CONFIRMED' });
      expect(patch.status).toBe(400); // whitelist rejects the field outright

      const put = await asManager(request(http).put(`/api/v1/banquet/bookings/${draft.body.id}`)).send({
        status: 'CONFIRMED',
      });
      expect([404, 405]).toContain(put.status);

      const del = await asManager(request(http).delete(`/api/v1/banquet/bookings/${draft.body.id}`));
      expect([404, 405]).toContain(del.status);

      const after = await prisma.banquetBooking.findUnique({ where: { id: draft.body.id } });
      expect(after!.status).toBe('DRAFT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HALL CONFLICTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Hall conflicts', () => {
    const window = (startIso: string, hours: number) => ({
      starts_at: startIso,
      ends_at: new Date(new Date(startIso).getTime() + hours * 3_600_000).toISOString(),
    });

    it('BC-1. a confirmed booking blocks an overlapping confirmation in the same hall', async () => {
      const base = '2027-06-01T10:00:00.000Z';
      const first = await createBooking(window(base, 4));
      const ok = await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();
      expect(ok.status).toBe(200);

      // starts inside the first booking
      const overlapping = await createBooking(window('2027-06-01T13:00:00.000Z', 4));
      const refused = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${overlapping.body.id}/confirm`),
      ).send();
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/already booked/i);
      // the draft survives — it simply could not claim the hall
      const still = await prisma.banquetBooking.findUnique({ where: { id: overlapping.body.id } });
      expect(still!.status).toBe('DRAFT');
    });

    it('BC-2. drafts never conflict with each other — several may exist for one slot', async () => {
      const slot = window('2027-06-02T10:00:00.000Z', 4);
      const a = await createBooking(slot);
      const b = await createBooking(slot);
      const c = await createBooking(slot);
      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    });

    it('BC-3. adjacent bookings do NOT conflict (ranges are half-open)', async () => {
      const first = await createBooking(window('2027-06-03T10:00:00.000Z', 4)); // 10:00–14:00
      expect((await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send()).status).toBe(200);

      const touching = await createBooking(window('2027-06-03T14:00:00.000Z', 4)); // 14:00–18:00
      const res = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${touching.body.id}/confirm`),
      ).send();
      expect(res.status).toBe(200);
    });

    it('BC-4. one minute of overlap is still a conflict', async () => {
      const first = await createBooking(window('2027-06-04T10:00:00.000Z', 4)); // 10:00–14:00
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();

      const overlap = await createBooking(window('2027-06-04T13:59:00.000Z', 4));
      expect(
        (await asManager(request(http).post(`/api/v1/banquet/bookings/${overlap.body.id}/confirm`)).send()).status,
      ).toBe(409);
    });

    it('BC-5. a different hall at the same time is fine', async () => {
      const slot = window('2027-06-05T10:00:00.000Z', 4);
      const a = await createBooking({ ...slot, hall_id: hallA.id });
      const b = await createBooking({ ...slot, hall_id: hallSmall.id, guest_count: 30 });
      expect((await asManager(request(http).post(`/api/v1/banquet/bookings/${a.body.id}/confirm`)).send()).status).toBe(200);
      expect((await asManager(request(http).post(`/api/v1/banquet/bookings/${b.body.id}/confirm`)).send()).status).toBe(200);
    });

    it('BC-6. cancelling releases the hall for someone else', async () => {
      const slot = window('2027-06-06T10:00:00.000Z', 4);
      const first = await createBooking(slot);
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();

      const second = await createBooking(slot);
      expect(
        (await asManager(request(http).post(`/api/v1/banquet/bookings/${second.body.id}/confirm`)).send()).status,
      ).toBe(409);

      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/cancel`)).send();
      expect(
        (await asManager(request(http).post(`/api/v1/banquet/bookings/${second.body.id}/confirm`)).send()).status,
      ).toBe(200);
    });

    it('BC-7. a COMPLETED event keeps its slot — history stays truthful', async () => {
      const slot = window('2027-06-07T10:00:00.000Z', 4);
      const first = await createBooking(slot);
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/complete`)).send();

      const second = await createBooking(slot);
      expect(
        (await asManager(request(http).post(`/api/v1/banquet/bookings/${second.body.id}/confirm`)).send()).status,
      ).toBe(409);
    });

    it('BC-8. overlap is judged on absolute instants, so an offset is respected', async () => {
      // 15:30 IST == 10:00 UTC. The same moment written two ways must collide.
      const first = await createBooking({
        starts_at: '2027-06-08T10:00:00.000Z',
        ends_at: '2027-06-08T14:00:00.000Z',
      });
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();

      const sameMomentDifferentNotation = await createBooking({
        starts_at: '2027-06-08T15:30:00.000+05:30',
        ends_at: '2027-06-08T19:30:00.000+05:30',
      });
      const res = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${sameMomentDifferentNotation.body.id}/confirm`),
      ).send();
      expect(res.status).toBe(409);
    });

    it('BC-9. the database rejects an overlap even when the service is bypassed', async () => {
      const slot = window('2027-06-09T10:00:00.000Z', 4);
      const first = await createBooking(slot);
      await asManager(request(http).post(`/api/v1/banquet/bookings/${first.body.id}/confirm`)).send();

      await expect(
        prisma.banquetBooking.create({
          data: {
            company_id: companyA.id,
            branch_id: branchA.id,
            customer_id: customerA.id,
            hall_id: hallA.id,
            starts_at: new Date(slot.starts_at),
            ends_at: new Date(slot.ends_at),
            guest_count: 10,
            status: 'CONFIRMED',
            package_name: 'direct',
            price_per_guest_minor: 1,
            currency: 'INR',
            total_amount_minor: 10,
          },
        }),
      ).rejects.toThrow();
    });

    it('BC-10. the database rejects a reversed window even when the service is bypassed', async () => {
      await expect(
        prisma.banquetBooking.create({
          data: {
            company_id: companyA.id,
            branch_id: branchA.id,
            customer_id: customerA.id,
            hall_id: hallA.id,
            starts_at: new Date('2027-07-01T14:00:00.000Z'),
            ends_at: new Date('2027-07-01T10:00:00.000Z'),
            guest_count: 10,
            status: 'DRAFT',
            package_name: 'direct',
            price_per_guest_minor: 1,
            currency: 'INR',
            total_amount_minor: 10,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADVANCE & BALANCE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Advance and balance', () => {
    it('BM-1. records an advance and derives the balance', async () => {
      const booking = await confirmed();
      const res = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`),
      ).send({ amount_minor: 2_500_000, currency: 'INR', method: 'cash' });
      expect(res.status).toBe(201);
      expect(res.body.payment).toMatchObject({ amount_minor: 2_500_000, currency: 'INR', method: 'cash' });
      expect(res.body.balance).toEqual({
        currency: 'INR',
        total_amount_minor: 10_000_000,
        paid_minor: 2_500_000,
        balance_minor: 7_500_000,
        fully_paid: false,
      });
    });

    it('BM-2. several payments accumulate exactly and settle to zero', async () => {
      const booking = await confirmed();
      const pay = (amount: number) =>
        asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send({
          amount_minor: amount,
          currency: 'INR',
        });

      await pay(2_500_000);
      await pay(100);
      const last = await pay(7_499_900);
      expect(last.status).toBe(201);
      expect(last.body.balance).toMatchObject({ paid_minor: 10_000_000, balance_minor: 0, fully_paid: true });

      const detail = await asManager(request(http).get(`/api/v1/banquet/bookings/${booking.id}`));
      expect(detail.body.balance.balance_minor).toBe(0);
      expect(detail.body.payments).toHaveLength(3);
    });

    it('BM-3. rejects overpayment, mismatched currency and non-integer amounts', async () => {
      const booking = await confirmed();
      const post = (body: Record<string, unknown>) =>
        asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send(body);

      const over = await post({ amount_minor: 10_000_001, currency: 'INR' });
      expect(over.status).toBe(409);
      expect(over.body.message).toMatch(/exceeds the outstanding balance/i);

      const wrongCurrency = await post({ amount_minor: 100, currency: 'USD' });
      expect(wrongCurrency.status).toBe(409);

      for (const body of [
        { amount_minor: 10.5, currency: 'INR' },
        { amount_minor: 0, currency: 'INR' },
        { amount_minor: -100, currency: 'INR' },
        { amount_minor: '100', currency: 'INR' },
        { amount_minor: 100, currency: 'inr' },
        { amount_minor: 100 },
      ]) {
        const res = await post(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }

      // nothing was recorded by any of the rejected attempts
      const detail = await asManager(request(http).get(`/api/v1/banquet/bookings/${booking.id}`));
      expect(detail.body.payments).toHaveLength(0);
    });

    it('BM-4. a cancelled booking takes no money', async () => {
      const booking = await confirmed();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/cancel`)).send();
      const res = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`),
      ).send({ amount_minor: 100, currency: 'INR' });
      expect(res.status).toBe(409);
    });

    it('BM-5. payment history is append-only at the database level', async () => {
      const booking = await confirmed();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send({
        amount_minor: 1000,
        currency: 'INR',
      });
      const row = await prisma.banquetPayment.findFirst({ where: { booking_id: booking.id } });

      await expect(
        prisma.banquetPayment.update({ where: { id: row!.id }, data: { amount_minor: 1 } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.banquetPayment.delete({ where: { id: row!.id } }),
      ).rejects.toThrow(/append-only/);
    });

    it('BM-6. there is no refund or payment-mutation route', async () => {
      const booking = await confirmed();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send({
        amount_minor: 1000,
        currency: 'INR',
      });
      const row = await prisma.banquetPayment.findFirst({ where: { booking_id: booking.id } });

      for (const [method, path] of [
        ['patch', `/api/v1/banquet/payments/${row!.id}`],
        ['delete', `/api/v1/banquet/payments/${row!.id}`],
        ['post', `/api/v1/banquet/payments/${row!.id}/refund`],
      ] as const) {
        const res = await asManager((request(http) as any)[method](path)).send({});
        expect([path, [404, 405].includes(res.status)]).toEqual([path, true]);
      }
    });

    it('BM-7. keeps the payment reference out of the audit trail', async () => {
      const booking = await confirmed();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send({
        amount_minor: 1000,
        currency: 'INR',
        reference: 'CARD-AUTH-8891',
      });
      const audits = await prisma.auditLog.findMany({ where: { entity_type: 'BANQUET_PAYMENT' } });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits.map((a) => a.payload))).not.toContain('CARD-AUTH-8891');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT PLAN + KDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Event plan and KDS', () => {
    it('BE-1. creates and replaces the event plan for a booking', async () => {
      const booking = await confirmed();
      const created = await asManager(
        request(http).put(`/api/v1/banquet/bookings/${booking.id}/event-plan`),
      ).send({
        service_at: booking.starts_at,
        setup_notes: 'Round tables of 10',
        kitchen_notes: 'No nuts',
      });
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({ setup_notes: 'Round tables of 10', kitchen_notes: 'No nuts' });

      const replaced = await asManager(
        request(http).put(`/api/v1/banquet/bookings/${booking.id}/event-plan`),
      ).send({ kitchen_notes: 'No nuts, no dairy' });
      expect(replaced.status).toBe(200);
      expect(replaced.body.kitchen_notes).toBe('No nuts, no dairy');
      expect(replaced.body.setup_notes).toBeNull();
      expect(replaced.body.id).toBe(created.body.id); // one plan per booking
    });

    it('BE-2. the kitchen board shows confirmed events for the branch-local day', async () => {
      const start = '2027-08-01T06:00:00.000Z'; // 11:30 IST
      const booking = await confirmed({
        starts_at: start,
        ends_at: '2027-08-01T10:00:00.000Z',
      });
      await asManager(request(http).put(`/api/v1/banquet/bookings/${booking.id}/event-plan`)).send({
        kitchen_notes: 'Extra spicy',
      });

      const board = await asManager(request(http).get('/api/v1/banquet/kds/board')).query({
        service_date: '2027-08-01',
      });
      expect(board.status).toBe(200);
      const entry = board.body.bookings.find((b: any) => b.id === booking.id);
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({ hall_name: 'Crystal', guest_count: 80, kitchen_notes: 'Extra spicy' });
      expect(entry.items.map((i: any) => i.name)).toEqual(['Paneer Tikka', 'Dal Makhani']);
      // staff board carries the customer; the chef projection does not
      expect(entry.customer_name).toBe('Meera Iyer');
    });

    it('BE-3. a draft never reaches the kitchen', async () => {
      const draft = await createBooking({
        starts_at: '2027-08-02T06:00:00.000Z',
        ends_at: '2027-08-02T10:00:00.000Z',
      });
      const board = await asManager(request(http).get('/api/v1/banquet/kds/board')).query({
        service_date: '2027-08-02',
      });
      expect(board.body.bookings.map((b: any) => b.id)).not.toContain(draft.body.id);
    });

    it('BE-4. items advance PENDING -> IN_PROGRESS -> READY and never backwards', async () => {
      const booking = await confirmed({
        starts_at: '2027-08-03T06:00:00.000Z',
        ends_at: '2027-08-03T10:00:00.000Z',
      });
      const item = booking.items[0];

      const started = await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${item.id}/start`),
      ).send();
      expect(started.status).toBe(200);
      expect(started.body).toMatchObject({ kds_status: 'IN_PROGRESS' });
      expect(started.body.started_at).not.toBeNull();

      const ready = await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${item.id}/ready`),
      ).send();
      expect(ready.status).toBe(200);
      expect(ready.body.kds_status).toBe('READY');

      // no going back, and no repeating
      expect((await asManager(request(http).post(`/api/v1/banquet/kds/items/${item.id}/start`)).send()).status).toBe(409);
      expect((await asManager(request(http).post(`/api/v1/banquet/kds/items/${item.id}/ready`)).send()).status).toBe(409);
    });

    it('BE-5. a small item may go straight to READY', async () => {
      const booking = await confirmed({
        starts_at: '2027-08-04T06:00:00.000Z',
        ends_at: '2027-08-04T10:00:00.000Z',
      });
      const res = await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${booking.items[1].id}/ready`),
      ).send();
      expect(res.status).toBe(200);
      expect(res.body.kds_status).toBe('READY');
    });

    it('BE-6. a draft booking has no kitchen items to advance', async () => {
      const draft = await createBooking();
      const res = await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${draft.body.items[0].id}/start`),
      ).send();
      expect(res.status).toBe(409);
    });

    it('BE-7. an item of another branch is 404', async () => {
      const booking = await confirmed();
      const res = await as(
        request(http).post(`/api/v1/banquet/kds/items/${booking.items[0].id}/start`),
        tokenManagerB,
        companyB.id,
        branchB.id,
      ).send();
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('BA-1. rejects an unauthenticated request', async () => {
      const res = await request(http)
        .get('/api/v1/banquet/bookings')
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);
      expect(res.status).toBe(401);
    });

    it('BA-2. banquet.view alone cannot mutate anything', async () => {
      const booking = await createBooking();
      const attempts: Array<[string, string, Record<string, unknown>]> = [
        ['post', '/api/v1/banquet/halls', { name: 'X', capacity: 10 }],
        ['post', '/api/v1/banquet/bookings', { customer_id: customerA.id, hall_id: hallA.id, package_id: packageA.id, guest_count: 10, ...nextWindow() }],
        ['patch', `/api/v1/banquet/bookings/${booking.body.id}`, { guest_count: 12 }],
        ['post', `/api/v1/banquet/bookings/${booking.body.id}/confirm`, {}],
        ['post', `/api/v1/banquet/bookings/${booking.body.id}/cancel`, {}],
        ['post', `/api/v1/banquet/bookings/${booking.body.id}/complete`, {}],
        ['post', `/api/v1/banquet/bookings/${booking.body.id}/payments`, { amount_minor: 100, currency: 'INR' }],
        ['put', `/api/v1/banquet/bookings/${booking.body.id}/event-plan`, {}],
      ];
      for (const [method, path, body] of attempts) {
        const res = await as((request(http) as any)[method](path), tokenViewerA, companyA.id, branchA.id).send(body);
        expect([path, res.status]).toEqual([path, 403]);
      }

      // ...but it CAN read
      const read = await as(request(http).get('/api/v1/banquet/bookings'), tokenViewerA, companyA.id, branchA.id);
      expect(read.status).toBe(200);
    });

    it('BA-3. banquet.kds.view can read the board but not advance an item', async () => {
      const booking = await confirmed();
      const board = await as(request(http).get('/api/v1/banquet/kds/board'), tokenViewerA, companyA.id, branchA.id);
      expect(board.status).toBe(200);

      const advance = await as(
        request(http).post(`/api/v1/banquet/kds/items/${booking.items[0].id}/start`),
        tokenViewerA,
        companyA.id,
        branchA.id,
      ).send();
      expect(advance.status).toBe(403);
    });

    it('BA-4. a user with no banquet permission cannot even read', async () => {
      const res = await as(request(http).get('/api/v1/banquet/bookings'), tokenStrangerA, companyA.id, branchA.id);
      expect(res.status).toBe(403);
    });

    it('BA-5. X-Branch-ID is not authorization', async () => {
      const res = await as(
        request(http).get('/api/v1/banquet/bookings'),
        tokenManagerA,
        companyA.id,
        branchA2.id, // manager holds no role at this branch
      );
      expect(res.status).toBe(403);
    });

    it('BA-6. cross-company header spoofing is refused', async () => {
      const res = await as(request(http).get('/api/v1/banquet/bookings'), tokenManagerB, companyA.id, branchA.id);
      expect(res.status).toBe(403);

      const pkg = await as(request(http).get('/api/v1/banquet/packages'), tokenManagerB, companyA.id);
      expect(pkg.status).toBe(403);
    });

    it('BA-7. an INACTIVE branch and a SUSPENDED company are refused', async () => {
      const off = await as(request(http).get('/api/v1/banquet/bookings'), tokenManagerA, companyA.id, branchOff.id);
      expect(off.status).toBe(403);

      const suspended = await as(request(http).get('/api/v1/banquet/bookings'), tokenSuspended, companyS.id, branchS.id);
      expect(suspended.status).toBe(403);
    });

    it('BA-8. an INACTIVE membership is refused', async () => {
      const email = 'b-membership@test.com';
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const user = await prisma.user.create({ data: { email, password_hash: hash } });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Banquet Manager' } });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: user.id, branch_id: branchA.id, role_id: role!.id },
      });
      const token = (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }))
        .body.accessToken as string;

      expect((await as(request(http).get('/api/v1/banquet/bookings'), token, companyA.id, branchA.id)).status).toBe(200);

      await prisma.companyMembership.updateMany({
        where: { user_id: user.id, company_id: companyA.id },
        data: { status: MembershipStatus.INACTIVE },
      });
      expect((await as(request(http).get('/api/v1/banquet/bookings'), token, companyA.id, branchA.id)).status).toBe(403);
    });

    it('BA-9. a globally disabled user cannot use an already-issued token', async () => {
      const email = 'b-disabled@test.com';
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const user = await prisma.user.create({ data: { email, password_hash: hash } });
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Banquet Manager' } });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: user.id, branch_id: branchA.id, role_id: role!.id },
      });
      const token = (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }))
        .body.accessToken as string;

      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.INACTIVE } });
      expect((await as(request(http).get('/api/v1/banquet/bookings'), token, companyA.id, branchA.id)).status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHEF DISPLAY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Chef display', () => {
    let chefDevice: string, queueDevice: string, revokedDevice: string, otherBranchDevice: string;
    const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

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
      chefDevice = await pair(branchA.id, DisplayDeviceKind.BANQUET_CHEF);
      queueDevice = await pair(branchA.id, DisplayDeviceKind.QUEUE_CUSTOMER);
      revokedDevice = await pair(branchA.id, DisplayDeviceKind.BANQUET_CHEF, DisplayDeviceStatus.REVOKED);
      otherBranchDevice = await pair(branchB.id, DisplayDeviceKind.BANQUET_CHEF);
    });

    it('BD-1. a chef device reads its own branch board, with no customer and no money', async () => {
      const booking = await confirmed({
        starts_at: '2027-09-01T06:00:00.000Z',
        ends_at: '2027-09-01T10:00:00.000Z',
      });
      await asManager(request(http).put(`/api/v1/banquet/bookings/${booking.id}/event-plan`)).send({
        kitchen_notes: 'Jain preparation',
      });

      const res = await asDevice(
        request(http).get('/api/v1/display/banquet/board'),
        chefDevice,
        branchA.id,
      );
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['branch_id', 'bookings', 'counts', 'service_date'].sort(),
      );

      const json = JSON.stringify(res.body);
      expect(json).not.toContain('Meera Iyer');
      expect(json).not.toContain('9812300001');
      expect(json).not.toMatch(/total_amount|price_per_guest|currency|customer|package_name/i);
      expect(json).not.toMatch(/password|credential|secret|hash|Bearer/i);
    });

    it('BD-2. the chef board carries what the kitchen needs', async () => {
      const res = await asDevice(
        request(http).get('/api/v1/display/banquet/board'),
        chefDevice,
        branchA.id,
      ).query({});
      expect(res.status).toBe(200);
      // today's board may be empty; the shape is what matters here
      expect(res.body.counts).toEqual(
        expect.objectContaining({ events: expect.any(Number), pending: expect.any(Number) }),
      );
    });

    it('BD-3. a queue device cannot read the chef board, and a chef device cannot read the queue board', async () => {
      expect(
        (await asDevice(request(http).get('/api/v1/display/banquet/board'), queueDevice, branchA.id)).status,
      ).toBe(403);
      expect(
        (await asDevice(request(http).get('/api/v1/display/queue/board'), chefDevice, branchA.id)).status,
      ).toBe(403);
    });

    it('BD-4. revoked, wrong-branch and tampered credentials are refused', async () => {
      expect(
        (await asDevice(request(http).get('/api/v1/display/banquet/board'), revokedDevice, branchA.id)).status,
      ).toBe(401);
      expect(
        (await asDevice(request(http).get('/api/v1/display/banquet/board'), otherBranchDevice, branchA.id)).status,
      ).toBe(401);
      expect(
        (await asDevice(request(http).get('/api/v1/display/banquet/board'), chefDevice, branchB.id)).status,
      ).toBe(401);

      const [id] = chefDevice.split('.');
      expect(
        (await asDevice(request(http).get('/api/v1/display/banquet/board'), `${id}.${'0'.repeat(64)}`, branchA.id)).status,
      ).toBe(401);
    });

    it('BD-5. a staff JWT cannot act as a display, and a display cannot act as staff', async () => {
      const jwtOnDisplay = await request(http)
        .get('/api/v1/display/banquet/board')
        .set('Authorization', `Bearer ${tokenManagerA}`)
        .set('X-Branch-ID', branchA.id);
      expect(jwtOnDisplay.status).toBe(401);

      const deviceOnStaff = await request(http)
        .get('/api/v1/banquet/kds/board')
        .set('Authorization', `Display ${chefDevice}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);
      expect(deviceOnStaff.status).toBe(401);
    });

    it('BD-6. a display device cannot mutate banquet data', async () => {
      const booking = await confirmed();
      for (const [method, path, body] of [
        ['post', '/api/v1/banquet/bookings', { customer_id: customerA.id, hall_id: hallA.id, package_id: packageA.id, guest_count: 10, ...nextWindow() }],
        ['post', `/api/v1/banquet/bookings/${booking.id}/confirm`, {}],
        ['post', `/api/v1/banquet/bookings/${booking.id}/payments`, { amount_minor: 100, currency: 'INR' }],
        ['post', `/api/v1/banquet/kds/items/${booking.items[0].id}/start`, {}],
      ] as const) {
        const res = await (request(http) as any)
          [method](path)
          .set('Authorization', `Display ${chefDevice}`)
          .set('X-Company-ID', companyA.id)
          .set('X-Branch-ID', branchA.id)
          .send(body);
        expect([path, res.status]).toEqual([path, 401]);
      }
    });

    it('BD-7. a chef device mints a single-use banquet-kds ticket and cannot ask for queue', async () => {
      const ticket = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        chefDevice,
        branchA.id,
      ).send({ channel: 'banquet-kds' });
      expect(ticket.status).toBe(201);
      expect(ticket.body).toMatchObject({ channel: 'banquet-kds', branch_id: branchA.id });
      expect(ticket.body.ticket).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(ticket.body)).not.toContain(chefDevice.split('.')[1]);

      const wrongChannel = await asDevice(
        request(http).post('/api/v1/display/stream-tickets'),
        chefDevice,
        branchA.id,
      ).send({ channel: 'queue' });
      expect(wrongChannel.status).toBe(403);

      // single use
      await request(http)
        .get('/api/v1/realtime/stream')
        .query({ ticket: ticket.body.ticket })
        .set('Accept', 'text/event-stream')
        .timeout({ deadline: 300 })
        .catch(() => undefined);
      const reused = await request(http)
        .get('/api/v1/realtime/stream')
        .query({ ticket: ticket.body.ticket });
      expect(reused.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REALTIME
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Realtime', () => {
    const scope = (branchId: string) => ({
      companyId: companyA.id,
      branchId,
      channel: RealtimeChannel.BANQUET_KDS,
    });

    const collect = (branchId: string, count: number, timeoutMs = 4000) =>
      new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        const sub = broker.subscribe(scope(branchId)).subscribe((e) => {
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

    it('BR-1. publishes confirm, event-plan and item updates on banquet-kds', async () => {
      const draft = await createBooking();
      const wait = collect(branchA.id, 3);

      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send();
      await asManager(request(http).put(`/api/v1/banquet/bookings/${draft.body.id}/event-plan`)).send({
        kitchen_notes: 'Gluten free',
      });
      await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${draft.body.items[0].id}/start`),
      ).send();

      const types = (await wait).map((e) => e.type);
      expect(types).toEqual([
        BANQUET_EVENT_TYPES.BOOKING_CONFIRMED,
        BANQUET_EVENT_TYPES.EVENT_PLAN_UPDATED,
        BANQUET_EVENT_TYPES.ITEM_UPDATED,
      ]);
    });

    it('BR-2. a draft creation publishes nothing', async () => {
      const seen: any[] = [];
      const sub = broker.subscribe(scope(branchA.id)).subscribe((e) => seen.push(e));
      await createBooking();
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toHaveLength(0);
      sub.unsubscribe();
    });

    it('BR-3. a failed mutation publishes nothing', async () => {
      const booking = await confirmed();
      const seen: any[] = [];
      const sub = broker.subscribe(scope(branchA.id)).subscribe((e) => seen.push(e));

      // already confirmed — this is an invalid transition
      const bad = await asManager(
        request(http).post(`/api/v1/banquet/bookings/${booking.id}/confirm`),
      ).send();
      expect(bad.status).toBe(409);
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toHaveLength(0);
      sub.unsubscribe();
    });

    it('BR-4. the payload is kitchen-safe', async () => {
      const draft = await createBooking();
      const wait = collect(branchA.id, 1);
      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send();
      const [event] = await wait;

      expect(Object.keys(event.data).sort()).toEqual(
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
      const json = JSON.stringify(event.data);
      expect(json).not.toContain('Meera Iyer');
      expect(json).not.toMatch(/total_amount|price_per_guest|currency|password|secret/i);
    });

    it('BR-5. events do not leak across branches', async () => {
      const otherBranch: any[] = [];
      const sub = broker.subscribe(scope(branchA2.id)).subscribe((e) => otherBranch.push(e));
      const draft = await createBooking();
      const wait = collect(branchA.id, 1);
      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send();
      await wait;
      await new Promise((r) => setTimeout(r, 100));
      expect(otherBranch).toHaveLength(0);
      sub.unsubscribe();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCURRENCY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Concurrency', () => {
    it('BX-1. simultaneous confirmations of competing drafts: exactly one claims the hall', async () => {
      const slot = {
        starts_at: '2027-10-01T10:00:00.000Z',
        ends_at: '2027-10-01T14:00:00.000Z',
      };
      const drafts = await Promise.all([createBooking(slot), createBooking(slot), createBooking(slot)]);
      expect(drafts.every((d) => d.status === 201)).toBe(true);

      const results = await Promise.all(
        drafts.map((d) =>
          asManager(request(http).post(`/api/v1/banquet/bookings/${d.body.id}/confirm`)).send(),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);

      const held = await prisma.banquetBooking.findMany({
        where: {
          hall_id: hallA.id,
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          starts_at: new Date(slot.starts_at),
        },
      });
      expect(held).toHaveLength(1);
    });

    it('BX-2. simultaneous confirmations of ONE booking: exactly one succeeds', async () => {
      const draft = await createBooking();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send(),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it('BX-3. concurrent payments never overshoot the balance', async () => {
      const booking = await confirmed(); // total 10,000,000
      const attempts = await Promise.all(
        Array.from({ length: 6 }, () =>
          asManager(request(http).post(`/api/v1/banquet/bookings/${booking.id}/payments`)).send({
            amount_minor: 4_000_000,
            currency: 'INR',
          }),
        ),
      );
      const accepted = attempts.filter((r) => r.status === 201);
      // 2 × 4,000,000 fits; a third would exceed the total.
      expect(accepted.length).toBeLessThanOrEqual(2);
      expect(accepted.length).toBeGreaterThanOrEqual(1);

      const detail = await asManager(request(http).get(`/api/v1/banquet/bookings/${booking.id}`));
      expect(detail.body.balance.paid_minor).toBe(accepted.length * 4_000_000);
      expect(detail.body.balance.balance_minor).toBeGreaterThanOrEqual(0);
      expect(detail.body.payments).toHaveLength(accepted.length);
    });

    it('BX-4. concurrent taps on one kitchen item: exactly one succeeds', async () => {
      const booking = await confirmed();
      const item = booking.items[0];
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          asManager(request(http).post(`/api/v1/banquet/kds/items/${item.id}/start`)).send(),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Audit', () => {
    it('BU-1. every banquet mutation is audited with company, branch and actor', async () => {
      const draft = await createBooking();
      await asManager(request(http).patch(`/api/v1/banquet/bookings/${draft.body.id}`)).send({ guest_count: 90 });
      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/confirm`)).send();
      await asManager(request(http).post(`/api/v1/banquet/bookings/${draft.body.id}/payments`)).send({
        amount_minor: 1000,
        currency: 'INR',
      });
      await asManager(request(http).put(`/api/v1/banquet/bookings/${draft.body.id}/event-plan`)).send({
        kitchen_notes: 'x',
      });
      await asManager(
        request(http).post(`/api/v1/banquet/kds/items/${draft.body.items[0].id}/start`),
      ).send();

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: { startsWith: 'BANQUET' }, branch_id: branchA.id },
      });
      const actions = new Set(audits.map((a) => (a.payload as any).action));
      for (const expected of [
        'create_booking',
        'update_booking',
        'confirm',
        'create_payment',
        'upsert_event_plan',
        'start_item',
      ]) {
        expect([expected, actions.has(expected)]).toEqual([expected, true]);
      }
      audits.forEach((a) => {
        expect(a.company_id).toBe(companyA.id);
        expect(a.user_id).toBe(managerA.id);
      });
    });

    it('BU-2. audit payloads carry no customer PII', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { entity_type: { startsWith: 'BANQUET' } },
      });
      const blob = JSON.stringify(audits.map((a) => a.payload));
      expect(blob).not.toContain('Meera Iyer');
      expect(blob).not.toContain('9812300001');
    });
  });
});

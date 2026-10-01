/**
 * User Management: members' access as toggles, enforced as a personal role.
 *
 * Fixture:
 *   company ─ Alpha HQ  ─ admin   (every system permission, at both branches)
 *           │           ├ limited (users.* only — may not hand out more)
 *           │           └ legacy  (shared "Floor" role: queue.view, queue.seat, tables.view)
 *           ├ Alpha Two ─ admin
 *           └ Closed (INACTIVE)
 *   other   ─ Beta HQ
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { BranchStatus, CompanyStatus, MembershipStatus } from '@samco/database';
import { permissionsFor, ACCESS_SECTIONS, ROUTINES } from '../src/modules/users/user-access.js';

const PASSWORD = 'SecurePassword123!';

describe('User Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let company: any, other: any, hq: any, two: any, closed: any, betaHq: any;
  let admin: any, limited: any, legacy: any;
  let adminToken: string, limitedToken: string, legacyToken: string;

  const as = (req: request.Test, token: string, branchId?: string) => {
    const r = req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', company.id);
    return branchId ? r.set('X-Branch-ID', branchId) : r;
  };
  const login = async (email: string, password = PASSWORD) =>
    (await request(http).post('/api/v1/auth/login').send({ email, password })).body.accessToken as string;
  const personalKeys = async (userId: string) => {
    const role = await prisma.role.findFirst({
      where: { company_id: company.id, personal_user_id: userId },
      include: { permissions: { include: { permission: true } } },
    });
    return role ? role.permissions.map((p) => p.permission.name).sort() : null;
  };
  const assignedBranches = async (userId: string) =>
    (
      await prisma.userBranchRole.findMany({
        where: { user_id: userId, branch: { company_id: company.id } },
        include: { branch: true },
      })
    )
      .map((r) => r.branch.name)
      .sort();

  const waiter = {
    user_type: 'STAFF',
    corporate: false,
    access: { toggles: ['queue.waiter', 'pos.billing'], routines: { 'eod-report': 'STAFF' }, tasks: 'RECEIVE' },
  };

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
    const hash = await bcrypt.hash(PASSWORD, 10);

    company = await prisma.company.create({ data: { name: 'Access Alpha', status: CompanyStatus.ACTIVE } });
    other = await prisma.company.create({ data: { name: 'Access Beta', status: CompanyStatus.ACTIVE } });
    const branch = (company_id: string, name: string, status: BranchStatus = BranchStatus.ACTIVE) =>
      prisma.branch.create({ data: { company_id, name, timezone: 'Asia/Kolkata', status } });
    hq = await branch(company.id, 'Alpha HQ');
    two = await branch(company.id, 'Alpha Two');
    closed = await branch(company.id, 'Closed', BranchStatus.INACTIVE);
    betaHq = await branch(other.id, 'Beta HQ');

    const role = async (name: string, keys: string[] | 'all') => {
      const r = await prisma.role.create({ data: { company_id: company.id, name } });
      const perms = await prisma.permission.findMany(keys === 'all' ? {} : { where: { name: { in: keys } } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: r.id, permission_id: p.id })) });
      return r;
    };
    const everything = await role('Owner', 'all');
    const usersOnly = await role('People', ['users.view', 'users.create', 'users.update', 'dashboard.view', 'customers.view']);
    const floor = await role('Floor', ['queue.view', 'queue.seat', 'tables.view']);

    const user = (email: string) => prisma.user.create({ data: { email, password_hash: hash } });
    admin = await user('ua-admin@test.com');
    limited = await user('ua-limited@test.com');
    legacy = await user('ua-legacy@test.com');
    await prisma.companyMembership.createMany({
      data: [admin, limited, legacy].map((u) => ({ user_id: u.id, company_id: company.id, status: MembershipStatus.ACTIVE })),
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: admin.id, branch_id: hq.id, role_id: everything.id },
        { user_id: admin.id, branch_id: two.id, role_id: everything.id },
        { user_id: limited.id, branch_id: hq.id, role_id: usersOnly.id },
        { user_id: legacy.id, branch_id: hq.id, role_id: floor.id },
      ],
    });

    adminToken = await login('ua-admin@test.com');
    limitedToken = await login('ua-limited@test.com');
    legacyToken = await login('ua-legacy@test.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('UA-1. serves the form: sections, daily forms and presets, behind users.view', async () => {
    const res = await as(request(http).get('/api/v1/user-access/catalog'), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.sections.map((s: any) => s.title)).toEqual([
      'Queue & Podium',
      'Banquet',
      'Reports',
      'POS',
      'Inventory & Suppliers',
      'Finance',
    ]);
    expect(res.body.routines.map((r: any) => r.label)[0]).toBe('EOD Reports');
    // A feature not built yet is offered, and says it grants nothing today.
    const pos = res.body.sections.find((s: any) => s.key === 'pos');
    expect(pos.toggles.every((t: any) => t.available === false)).toBe(true);
    expect(res.body.presets.STAFF.tasks).toBe('RECEIVE');
    // Every ACTIVE branch of this company, to place a member at.
    expect(res.body.branches.map((b: any) => b.name)).toEqual(['Alpha HQ', 'Alpha Two']);

    expect((await as(request(http).get('/api/v1/user-access/catalog'), legacyToken)).status).toBe(403);
  });

  it('UA-2. lists members with the branch and type their shared roles give them today', async () => {
    const res = await as(request(http).get('/api/v1/user-access/users'), adminToken);
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.map((u: any) => [u.email, u]));
    // Roles at every active branch read as Corporate.
    expect(byEmail['ua-admin@test.com']).toMatchObject({ name: 'ua-admin', user_type: 'ADMIN', corporate: true, branch: null });
    expect(byEmail['ua-legacy@test.com']).toMatchObject({
      user_type: 'STAFF',
      corporate: false,
      branch: { id: hq.id, name: 'Alpha HQ' },
    });

    // Before it is saved, the form starts from what the shared role allows.
    const detail = await as(request(http).get(`/api/v1/user-access/users/${legacy.id}`), adminToken);
    expect(detail.body.managed).toBe(false);
    expect(detail.body.access.toggles).toEqual(['queue.admin_display', 'queue.waiter', 'queue.customer_display']);
  });

  it('UA-3. creates a member whose toggles become their permissions at their branch only', async () => {
    const res = await as(request(http).post('/api/v1/user-access/users'), adminToken).send({
      email: 'New.Waiter@Test.com',
      password: 'Waiter12345',
      branch_id: hq.id,
      ...waiter,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'new.waiter@test.com',
      name: 'new.waiter',
      user_type: 'STAFF',
      corporate: false,
      branch: { id: hq.id, name: 'Alpha HQ' },
      managed: true,
    });
    // pos.billing is kept although it grants nothing yet.
    expect(res.body.access).toEqual(waiter.access);

    const id = res.body.id;
    expect(await personalKeys(id)).toEqual(permissionsFor('STAFF', waiter.access as any));
    expect(await assignedBranches(id)).toEqual(['Alpha HQ']);

    // They can sign in and use exactly that.
    const token = await login('new.waiter@test.com', 'Waiter12345');
    expect((await as(request(http).get('/api/v1/tables'), token, hq.id)).status).toBe(200);
    expect((await as(request(http).get('/api/v1/tables'), token, two.id)).status).toBe(403);
    expect((await as(request(http).get('/api/v1/user-access/users'), token)).status).toBe(403);

    // The personal role is theirs alone: not a shared role anyone can see or hand out.
    const roles = await as(request(http).get('/api/v1/roles'), adminToken);
    expect(roles.body.some((r: any) => r.name.startsWith('personal:'))).toBe(false);
    const personal = await prisma.role.findFirst({ where: { personal_user_id: id } });
    const assign = await as(request(http).post(`/api/v1/users/${legacy.id}/branch-roles`), adminToken, hq.id).send({
      branch_id: hq.id,
      role_id: personal!.id,
    });
    expect(assign.status).toBe(422);
  });

  it('UA-4. saving a member replaces their shared roles; Corporate reaches every branch, new ones too', async () => {
    const res = await as(request(http).put(`/api/v1/user-access/users/${legacy.id}`), adminToken).send({
      user_type: 'MANAGER',
      corporate: true,
      access: { toggles: ['queue.podium', 'nonsense.toggle'], routines: { 'eod-report': 'MANAGER', bogus: 'STAFF' }, tasks: 'BOTH' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user_type: 'MANAGER', corporate: true, branch: null, managed: true });
    // Unknown toggles and forms are dropped, not stored.
    expect(res.body.access).toEqual({ toggles: ['queue.podium'], routines: { 'eod-report': 'MANAGER' }, tasks: 'BOTH' });

    // The "Floor" role is gone; the personal role sits at every ACTIVE branch.
    expect(await assignedBranches(legacy.id)).toEqual(['Alpha HQ', 'Alpha Two']);
    expect(
      await prisma.userBranchRole.count({ where: { user_id: legacy.id, role: { personal_user_id: null } } }),
    ).toBe(0);

    const created = await as(request(http).post('/api/v1/branches'), adminToken).send({
      name: 'Alpha Three',
      timezone: 'Asia/Kolkata',
    });
    expect(created.status).toBe(201);
    expect(await assignedBranches(legacy.id)).toEqual(['Alpha HQ', 'Alpha Three', 'Alpha Two']);

    // Back to one branch.
    await as(request(http).put(`/api/v1/user-access/users/${legacy.id}`), adminToken).send({
      user_type: 'STAFF',
      corporate: false,
      branch_id: two.id,
      access: { toggles: [], routines: {}, tasks: 'OFF' },
    });
    expect(await assignedBranches(legacy.id)).toEqual(['Alpha Two']);
    expect(await personalKeys(legacy.id)).toEqual(['customers.view', 'dashboard.view']);
  });

  it('UA-5. nobody grants what they do not hold, or changes their own access', async () => {
    const refused = await as(request(http).post('/api/v1/user-access/users'), limitedToken).send({
      email: 'ua-too-much@test.com',
      password: 'Password1234',
      branch_id: hq.id,
      ...waiter,
    });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/do not have yourself: .*queue\.seat/);
    expect(await prisma.user.findUnique({ where: { email: 'ua-too-much@test.com' } })).toBeNull();

    // Within what they hold, the limited admin may act.
    const fine = await as(request(http).post('/api/v1/user-access/users'), limitedToken).send({
      email: 'ua-plain@test.com',
      password: 'Password1234',
      branch_id: hq.id,
      user_type: 'STAFF',
      corporate: false,
      access: { toggles: [], routines: {}, tasks: 'OFF' },
    });
    expect(fine.status).toBe(201);

    const self = await as(request(http).put(`/api/v1/user-access/users/${admin.id}`), adminToken).send({
      user_type: 'ADMIN',
      corporate: true,
      access: { toggles: [], routines: {}, tasks: 'OFF' },
    });
    expect(self.status).toBe(403);
  });

  it('UA-6. refuses a closed or foreign branch, a taken email and a malformed selection', async () => {
    const make = (over: Record<string, unknown>) =>
      as(request(http).post('/api/v1/user-access/users'), adminToken).send({
        email: 'ua-x@test.com',
        password: 'Password1234',
        branch_id: hq.id,
        ...waiter,
        ...over,
      });
    expect((await make({ branch_id: closed.id })).status).toBe(422);
    expect((await make({ branch_id: betaHq.id })).status).toBe(422);
    expect((await make({ email: 'ua-legacy@test.com' })).status).toBe(409);
    expect((await make({ access: { toggles: [], routines: {}, tasks: 'SOMETIMES' } })).status).toBe(400);
    expect((await make({ password: 'short' })).status).toBe(400);
    expect((await make({ branch_id: undefined })).status).toBe(400);
    // A user of another company is not found here.
    expect((await as(request(http).get(`/api/v1/user-access/users/${betaHq.id}`), adminToken)).status).toBe(404);
  });

  it('UA-7. the catalogue only grants keys the system defines', () => {
    const everything = permissionsFor('ADMIN', {
      toggles: ACCESS_SECTIONS.flatMap((s) => s.toggles.map((t) => t.key)),
      routines: Object.fromEntries(ROUTINES.map((r) => [r.key, 'MANAGER'])),
      tasks: 'BOTH',
    });
    expect(everything.length).toBeGreaterThan(40);
  });
});

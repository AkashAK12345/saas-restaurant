/**
 * User groups: named lists of a company's members, kept on User Management.
 *
 * Fixture:
 *   company ─ admin  (users.view + users.update)
 *           ├ viewer (users.view only)
 *           ├ ann, bob (members)
 *           └ gone   (INACTIVE membership)
 *   other   ─ outsider
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

const PASSWORD = 'SecurePassword123!';

describe('User groups (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let company: any, other: any;
  let ann: any, bob: any, gone: any, outsider: any;
  let adminToken: string, viewerToken: string, outsiderToken: string;

  const as = (req: request.Test, token: string, companyId = company.id) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
  const login = async (email: string) =>
    (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.accessToken as string;

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

    company = await prisma.company.create({ data: { name: 'Groups Alpha', status: CompanyStatus.ACTIVE } });
    other = await prisma.company.create({ data: { name: 'Groups Beta', status: CompanyStatus.ACTIVE } });
    const branch = await prisma.branch.create({
      data: { company_id: company.id, name: 'HQ', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
    });
    const otherBranch = await prisma.branch.create({
      data: { company_id: other.id, name: 'Beta HQ', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE },
    });

    const role = async (company_id: string, name: string, keys: string[]) => {
      const r = await prisma.role.create({ data: { company_id, name } });
      const perms = await prisma.permission.findMany({ where: { name: { in: keys } } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: r.id, permission_id: p.id })) });
      return r;
    };
    const manage = await role(company.id, 'People', ['users.view', 'users.update']);
    const look = await role(company.id, 'Look', ['users.view']);
    const otherManage = await role(other.id, 'People', ['users.view', 'users.update']);

    const user = (email: string, first_name?: string) =>
      prisma.user.create({ data: { email, password_hash: hash, first_name: first_name ?? null } });
    const admin = await user('ug-admin@test.com');
    const viewer = await user('ug-viewer@test.com');
    ann = await user('ann@test.com', 'Ann');
    bob = await user('bob@test.com');
    gone = await user('gone@test.com');
    outsider = await user('ug-outsider@test.com');

    await prisma.companyMembership.createMany({
      data: [
        ...[admin, viewer, ann, bob].map((u) => ({ user_id: u.id, company_id: company.id, status: MembershipStatus.ACTIVE })),
        { user_id: gone.id, company_id: company.id, status: MembershipStatus.INACTIVE },
        { user_id: outsider.id, company_id: other.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: admin.id, branch_id: branch.id, role_id: manage.id },
        { user_id: viewer.id, branch_id: branch.id, role_id: look.id },
        { user_id: outsider.id, branch_id: otherBranch.id, role_id: otherManage.id },
      ],
    });

    adminToken = await login('ug-admin@test.com');
    viewerToken = await login('ug-viewer@test.com');
    outsiderToken = await login('ug-outsider@test.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  let kitchen: any;

  it('UG-1. creates a group of active members, listed by name with members named', async () => {
    const res = await as(request(http).post('/api/v1/user-groups'), adminToken).send({
      name: '  Kitchen ',
      member_ids: [bob.id, ann.id, ann.id],
    });
    expect(res.status).toBe(201);
    kitchen = res.body;
    expect(kitchen).toMatchObject({
      name: 'Kitchen',
      members: [
        { id: ann.id, name: 'Ann', email: 'ann@test.com' },
        { id: bob.id, name: 'bob', email: 'bob@test.com' },
      ],
    });

    await as(request(http).post('/api/v1/user-groups'), adminToken).send({ name: 'banquet', member_ids: [] });
    const list = await as(request(http).get('/api/v1/user-groups'), viewerToken);
    expect(list.status).toBe(200);
    // Alphabetical regardless of case, as the reference lists them.
    expect(list.body.map((g: any) => g.name)).toEqual(['banquet', 'Kitchen']);
  });

  it('UG-2. renames and replaces the members; names are unique regardless of case', async () => {
    const res = await as(request(http).put(`/api/v1/user-groups/${kitchen.id}`), adminToken).send({
      name: 'Kitchen Team',
      member_ids: [bob.id],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Kitchen Team', members: [{ id: bob.id }] });

    const clash = await as(request(http).post('/api/v1/user-groups'), adminToken).send({
      name: 'KITCHEN team',
      member_ids: [],
    });
    expect(clash.status).toBe(409);
    // Keeping its own name is no clash.
    expect(
      (await as(request(http).put(`/api/v1/user-groups/${kitchen.id}`), adminToken).send({ name: 'kitchen team', member_ids: [bob.id] }))
        .status,
    ).toBe(200);
  });

  it('UG-3. only active members of this company can be in a group', async () => {
    for (const id of [gone.id, outsider.id]) {
      const res = await as(request(http).put(`/api/v1/user-groups/${kitchen.id}`), adminToken).send({
        name: 'Kitchen Team',
        member_ids: [id],
      });
      expect(res.status).toBe(422);
    }
    // Someone who leaves drops out of the list.
    await prisma.companyMembership.update({
      where: { user_id_company_id: { user_id: bob.id, company_id: company.id } },
      data: { status: MembershipStatus.INACTIVE },
    });
    const list = await as(request(http).get('/api/v1/user-groups'), adminToken);
    expect(list.body.find((g: any) => g.id === kitchen.id).members).toEqual([]);
    await prisma.companyMembership.update({
      where: { user_id_company_id: { user_id: bob.id, company_id: company.id } },
      data: { status: MembershipStatus.ACTIVE },
    });
  });

  it('UG-4. reading needs users.view, changing needs users.update, and another company sees nothing', async () => {
    expect((await as(request(http).post('/api/v1/user-groups'), viewerToken).send({ name: 'X', member_ids: [] })).status).toBe(403);
    expect((await as(request(http).delete(`/api/v1/user-groups/${kitchen.id}`), viewerToken)).status).toBe(403);
    expect((await as(request(http).get('/api/v1/user-groups'), outsiderToken, other.id)).body).toEqual([]);
    expect(
      (await as(request(http).put(`/api/v1/user-groups/${kitchen.id}`), outsiderToken, other.id).send({ name: 'Mine', member_ids: [] }))
        .status,
    ).toBe(404);
    expect((await as(request(http).post('/api/v1/user-groups'), adminToken).send({ name: '   ', member_ids: [] })).status).toBe(400);
    expect((await as(request(http).post('/api/v1/user-groups'), adminToken).send({ name: 'Y', member_ids: ['nope'] })).status).toBe(400);
  });

  it('UG-5. deletes a group, members and all', async () => {
    const res = await as(request(http).delete(`/api/v1/user-groups/${kitchen.id}`), adminToken);
    expect(res.status).toBe(204);
    expect(await prisma.userGroupMember.count({ where: { group_id: kitchen.id } })).toBe(0);
    expect((await as(request(http).delete(`/api/v1/user-groups/${kitchen.id}`), adminToken)).status).toBe(404);
  });
});

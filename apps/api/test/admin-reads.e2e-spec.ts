/**
 * Read endpoints added for the administration screens:
 *
 *   GET /roles/permissions        the seeded permission catalogue (roles.view)
 *   GET /users/:id/branch-roles   a member's assignments in this company (users.view)
 *
 * Fixture:
 *   companyA ─ branchA  ─ adminA  (roles.view, users.view)
 *            │          └ staffA  (no admin permissions; holds "Staff" here)
 *            └ branchA2 ─ staffA  (holds "Staff" here too)
 *   companyB ─ branchB  ─ adminB  (roles.view, users.view); staffA ALSO a member,
 *                                  holding "Beta Staff" at branchB
 *   leaver   ─ INACTIVE membership in companyA
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
import { SYSTEM_PERMISSIONS } from '../src/common/authorization/permission-keys.js';

const PASSWORD = 'SecurePassword123!';

describe('Admin read endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let companyA: any, companyB: any, branchA: any, branchA2: any, branchB: any;
  let staffA: any, leaver: any;
  let adminTokenA: string, adminTokenB: string, staffTokenA: string;

  const as = (req: request.Test, token: string, companyId: string) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);

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

    companyA = await prisma.company.create({ data: { name: 'Reads Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Reads Beta', status: CompanyStatus.ACTIVE } });
    const branch = (company_id: string, name: string) =>
      prisma.branch.create({ data: { company_id, name, timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA = await branch(companyA.id, 'Alpha HQ');
    branchA2 = await branch(companyA.id, 'Alpha Two');
    branchB = await branch(companyB.id, 'Beta HQ');

    const perms = await prisma.permission.findMany({ where: { name: { in: ['roles.view', 'users.view'] } } });
    const adminRole = async (company_id: string) => {
      const role = await prisma.role.create({ data: { company_id, name: 'Admin' } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })) });
      return role;
    };
    const adminRoleA = await adminRole(companyA.id);
    const adminRoleB = await adminRole(companyB.id);
    const staffRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Staff' } });
    const staffRoleB = await prisma.role.create({ data: { company_id: companyB.id, name: 'Beta Staff' } });

    const user = (email: string) => prisma.user.create({ data: { email, password_hash: hash } });
    const adminA = await user('reads-admin-a@test.com');
    const adminB = await user('reads-admin-b@test.com');
    staffA = await user('reads-staff@test.com');
    leaver = await user('reads-leaver@test.com');

    await prisma.companyMembership.createMany({
      data: [
        { user_id: adminA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: adminB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: staffA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: staffA.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: leaver.id, company_id: companyA.id, status: MembershipStatus.INACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: adminA.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: adminB.id, branch_id: branchB.id, role_id: adminRoleB.id },
        { user_id: staffA.id, branch_id: branchA.id, role_id: staffRoleA.id },
        { user_id: staffA.id, branch_id: branchA2.id, role_id: staffRoleA.id },
        { user_id: staffA.id, branch_id: branchB.id, role_id: staffRoleB.id },
        { user_id: leaver.id, branch_id: branchA.id, role_id: staffRoleA.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.accessToken as string;
    adminTokenA = await login('reads-admin-a@test.com');
    adminTokenB = await login('reads-admin-b@test.com');
    staffTokenA = await login('reads-staff@test.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  describe('GET /roles/permissions', () => {
    it('AR-1. returns the whole seeded catalogue with name, module and description only', async () => {
      const res = await as(request(http).get('/api/v1/roles/permissions'), adminTokenA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.map((p: any) => p.name).sort()).toEqual(SYSTEM_PERMISSIONS.map((p) => p.name).sort());
      for (const entry of res.body) expect(Object.keys(entry).sort()).toEqual(['description', 'module', 'name']);
    });

    it('AR-2. requires authentication, company context and roles.view', async () => {
      expect((await request(http).get('/api/v1/roles/permissions')).status).toBe(401);
      expect(
        (await request(http).get('/api/v1/roles/permissions').set('Authorization', `Bearer ${adminTokenA}`)).status,
      ).toBe(403);
      expect((await as(request(http).get('/api/v1/roles/permissions'), staffTokenA, companyA.id)).status).toBe(403);
      // A company the caller does not belong to proves nothing.
      expect((await as(request(http).get('/api/v1/roles/permissions'), adminTokenA, companyB.id)).status).toBe(403);
    });

    it('AR-3. does not shadow GET /roles/:id', async () => {
      const role = await prisma.role.findFirstOrThrow({ where: { company_id: companyA.id, name: 'Staff' } });
      const res = await as(request(http).get(`/api/v1/roles/${role.id}`), adminTokenA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Staff');
    });
  });

  describe('GET /users/:id/branch-roles', () => {
    it("AR-4. lists only this company's assignments, with branch and role names", async () => {
      const res = await as(request(http).get(`/api/v1/users/${staffA.id}/branch-roles`), adminTokenA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.map((a: any) => `${a.branch.name}/${a.role.name}`)).toEqual(['Alpha HQ/Staff', 'Alpha Two/Staff']);
      for (const a of res.body) {
        expect(Object.keys(a).sort()).toEqual(['branch', 'id', 'role']);
        expect(JSON.stringify(a)).not.toMatch(/password|hash|token|secret/i);
      }
    });

    it('AR-5. the other company sees only its own assignment of the same person', async () => {
      const res = await as(request(http).get(`/api/v1/users/${staffA.id}/branch-roles`), adminTokenB, companyB.id);
      expect(res.status).toBe(200);
      expect(res.body.map((a: any) => `${a.branch.name}/${a.role.name}`)).toEqual(['Beta HQ/Beta Staff']);
    });

    it('AR-6. a user who is not an ACTIVE member here is a 404, not an empty list', async () => {
      expect((await as(request(http).get(`/api/v1/users/${leaver.id}/branch-roles`), adminTokenA, companyA.id)).status).toBe(404);
      expect((await as(request(http).get(`/api/v1/users/${leaver.id}/branch-roles`), adminTokenB, companyB.id)).status).toBe(404);
    });

    it('AR-7. requires users.view in the company named by the header, and a UUID', async () => {
      expect((await request(http).get(`/api/v1/users/${staffA.id}/branch-roles`)).status).toBe(401);
      expect((await as(request(http).get(`/api/v1/users/${staffA.id}/branch-roles`), staffTokenA, companyA.id)).status).toBe(403);
      expect((await as(request(http).get(`/api/v1/users/${staffA.id}/branch-roles`), adminTokenB, companyA.id)).status).toBe(403);
      expect((await as(request(http).get('/api/v1/users/not-a-uuid/branch-roles'), adminTokenA, companyA.id)).status).toBe(400);
    });
  });
});

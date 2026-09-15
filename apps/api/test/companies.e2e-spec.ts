/**
 * Company & Branch Management E2E Test Suite
 *
 * Covers all 40 required test cases:
 *   - Company management (1–9)
 *   - Branch management (10–20)
 *   - Membership management (21–26)
 *   - Cross-company security (27–31)
 *   - Authorization (32–38)
 *   - Regression: auth + RBAC (39–40, run separately via existing specs)
 *
 * Test data is set up directly via PrismaService (Company/Branch CRUD is what we're testing).
 *
 * Data layout:
 *   companyA (ACTIVE) — adminUserA has full admin role at branchA
 *   companyB (ACTIVE) — adminUserB has full admin role at branchB
 *   restrictedUser    — member of companyA, cashierRoleA at branchA (no company/branch/member perms)
 *   noMemberUser      — no membership anywhere
 *   superadminUser    — is_superadmin=true, no membership
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { resetDatabase, purgeAuditLogs, assertPermissionsSeeded } from './utils/db.js';
import * as bcrypt from 'bcrypt';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import {
  MembershipStatus,
  CompanyStatus,
  BranchStatus,
} from '@samco/database';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Company & Branch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Entities
  let companyA: any;
  let companyB: any;
  let branchA: any;
  let branchB: any;
  let adminRoleA: any;
  let cashierRoleA: any;
  let adminRoleB: any;

  // Users
  let adminUserA: any;
  let adminUserB: any;
  let restrictedUser: any;
  let noMemberUser: any;
  let extraUser: any; // used for membership addition tests

  // Tokens
  let adminTokenA: string;
  let adminTokenB: string;
  let restrictedToken: string;
  let noMemberToken: string;
  let superadminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // ── Clean database ────────────────────────────────────────────────────────
    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const pwdHash = await bcrypt.hash(PASSWORD, SALT);

    // ── Users ────────────────────────────────────────────────────────────────
    adminUserA = await prisma.user.create({
      data: { email: 'admin-a@alpha.com', password_hash: pwdHash, first_name: 'Admin', last_name: 'Alpha' },
    });
    adminUserB = await prisma.user.create({
      data: { email: 'admin-b@beta.com', password_hash: pwdHash, first_name: 'Admin', last_name: 'Beta' },
    });
    restrictedUser = await prisma.user.create({
      data: { email: 'restricted@alpha.com', password_hash: pwdHash, first_name: 'Restricted', last_name: 'Alpha' },
    });
    noMemberUser = await prisma.user.create({
      data: { email: 'nomember@test.com', password_hash: pwdHash },
    });
    await prisma.user.create({
      data: {
        email: 'superadmin@samco.com', password_hash: pwdHash,
        is_superadmin: true,
      },
    });
    extraUser = await prisma.user.create({
      data: { email: 'extra@test.com', password_hash: pwdHash, first_name: 'Extra', last_name: 'User' },
    });

    // ── Companies ────────────────────────────────────────────────────────────
    companyA = await prisma.company.create({
      data: { name: 'Alpha Corp', status: CompanyStatus.ACTIVE },
    });
    companyB = await prisma.company.create({
      data: { name: 'Beta Corp', status: CompanyStatus.ACTIVE },
    });

    // ── Branches ────────────────────────────────────────────────────────────
    branchA = await prisma.branch.create({
      data: {
        company_id: companyA.id,
        name: 'Alpha HQ',
        timezone: 'Asia/Kolkata',
        status: BranchStatus.ACTIVE,
      },
    });
    branchB = await prisma.branch.create({
      data: {
        company_id: companyB.id,
        name: 'Beta HQ',
        timezone: 'America/New_York',
        status: BranchStatus.ACTIVE,
      },
    });

    // ── Roles ────────────────────────────────────────────────────────────────
    adminRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Admin' },
    });
    cashierRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Cashier' },
    });
    adminRoleB = await prisma.role.create({
      data: { company_id: companyB.id, name: 'Admin' },
    });

    // ── Permission setup ─────────────────────────────────────────────────────
    const allPerms = [
      'companies.view', 'companies.update', 'companies.disable',
      'branches.view', 'branches.create', 'branches.update', 'branches.disable',
      'memberships.view', 'memberships.create', 'memberships.update',
      'users.view', 'users.create', 'users.update',
      'roles.view', 'roles.create', 'roles.update',
    ];

    const perms = await prisma.permission.findMany({
      where: { name: { in: allPerms } },
    });
    const permMap = new Map(perms.map((p) => [p.name, p]));

    // adminRoleA gets all management permissions
    await prisma.rolePermission.createMany({
      data: allPerms
        .filter((n) => permMap.has(n))
        .map((n) => ({ role_id: adminRoleA.id, permission_id: permMap.get(n)!.id })),
    });

    // cashierRoleA gets only pos.order.create
    const posPerm = await prisma.permission.findUnique({ where: { name: 'pos.order.create' } });
    if (posPerm) {
      await prisma.rolePermission.create({
        data: { role_id: cashierRoleA.id, permission_id: posPerm.id },
      });
    }

    // adminRoleB: all management permissions
    await prisma.rolePermission.createMany({
      data: allPerms
        .filter((n) => permMap.has(n))
        .map((n) => ({ role_id: adminRoleB.id, permission_id: permMap.get(n)!.id })),
    });

    // ── Memberships ──────────────────────────────────────────────────────────
    await prisma.companyMembership.createMany({
      data: [
        { user_id: adminUserA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: restrictedUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: adminUserB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
      ],
    });

    // ── Branch roles ─────────────────────────────────────────────────────────
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: adminUserA.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: restrictedUser.id, branch_id: branchA.id, role_id: cashierRoleA.id },
        { user_id: adminUserB.id, branch_id: branchB.id, role_id: adminRoleB.id },
      ],
    });

    // ── Login ────────────────────────────────────────────────────────────────
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      return res.body.accessToken as string;
    };

    adminTokenA = await login('admin-a@alpha.com');
    adminTokenB = await login('admin-b@beta.com');
    restrictedToken = await login('restricted@alpha.com');
    noMemberToken = await login('nomember@test.com');
    superadminToken = await login('superadmin@samco.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORIZATION (32–38) — tested first so later tests can assume correct auth
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('32. missing authentication returns 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/companies');
      expect(res.status).toBe(401);
    });

    it('33. missing permission returns 403', async () => {
      // restrictedUser has no companies.update permission
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${restrictedToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Should Fail' });
      expect(res.status).toBe(403);
    });

    it('34. missing X-Company-ID is rejected on company-scoped endpoints', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        // X-Company-ID deliberately omitted
        .send({ name: 'No Context' });
      expect(res.status).toBe(403);
    });

    it('35. invalid company UUID is rejected', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/companies/not-a-uuid')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', 'not-a-uuid')
        .send({ name: 'Bad UUID' });
      // Guard will try to find membership with invalid UUID — returns 403
      expect([400, 403, 404]).toContain(res.status);
    });

    it('36. invalid branch UUID returns 400 or 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches/not-a-uuid')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect([400, 404]).toContain(res.status);
    });

    it('37. invalid membership ID returns 400 or 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/not-a-uuid`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });
      expect([400, 404]).toContain(res.status);
    });

    it('38. is_superadmin does not silently bypass the authorization model', async () => {
      // superadminUser has is_superadmin=true but NO CompanyMembership
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${superadminToken}`);
      // No membership → should get 404 (not found / not visible)
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY MANAGEMENT (1–9)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Company Management', () => {
    it('1. authenticated authorized user can list their companies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).toContain(companyA.id);
      expect(ids).not.toContain(companyB.id); // adminUserA is not a member of companyB
    });

    it('2. user cannot see a company where they have no active membership', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${noMemberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0); // noMemberUser belongs to no companies
    });

    it('3. inactive membership does not grant normal company access', async () => {
      // Create an INACTIVE membership for noMemberUser in companyA
      const inactiveMembership = await prisma.companyMembership.create({
        data: { user_id: noMemberUser.id, company_id: companyA.id, status: MembershipStatus.INACTIVE },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${noMemberToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).not.toContain(companyA.id); // INACTIVE membership not shown

      await prisma.companyMembership.delete({ where: { id: inactiveMembership.id } });
    });

    it('4. user can retrieve an authorized company', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(companyA.id);
      expect(res.body.name).toBe('Alpha Corp');
    });

    it('5. user cannot retrieve another company details (404)', async () => {
      // adminUserA is not a member of companyB
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(404);
    });

    it('5b. URL company ID mismatch with X-Company-ID is rejected for GET /companies/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });

    it('5c. user with no access sends X-Company-ID matching URL -> rejected', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id);

      expect(res.status).toBe(404);
    });

    it('5d. user sends correct X-Company-ID for valid URL -> allowed', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .set('X-Company-ID', companyB.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(companyB.id);
    });

    it('6. authorized company administrator can update their company', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Alpha Corp Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Alpha Corp Updated');

      // Restore
      await prisma.company.update({
        where: { id: companyA.id },
        data: { name: 'Alpha Corp' },
      });
    });

    it('7. user cannot update another company (403 from guard)', async () => {
      // adminUserA sends companyB.id as X-Company-ID — no membership there
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('7b. URL company ID mismatch with X-Company-ID is rejected', async () => {
      // Send companyA token but target companyB in URL
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id) // authorized for A, but URL is B
        .send({ name: 'Mismatch' });

      expect(res.status).toBe(403);
    });

    it('8. company status can be changed to INACTIVE', async () => {
      // Create a disposable company for status testing
      const tempCompany = await prisma.company.create({
        data: { name: 'Temp Status Co', status: CompanyStatus.ACTIVE },
      });
      const tempMembership = await prisma.companyMembership.create({
        data: { user_id: adminUserA.id, company_id: tempCompany.id, status: MembershipStatus.ACTIVE },
      });
      const tempBranch = await prisma.branch.create({
        data: { company_id: tempCompany.id, name: 'Temp Branch', timezone: 'UTC' },
      });
      const tempRole = await prisma.role.create({
        data: { company_id: tempCompany.id, name: 'Admin' },
      });
      const perms = await prisma.permission.findMany({
        where: { name: { in: ['companies.update', 'companies.disable'] } },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ role_id: tempRole.id, permission_id: p.id })),
      });
      await prisma.userBranchRole.create({
        data: { user_id: adminUserA.id, branch_id: tempBranch.id, role_id: tempRole.id },
      });

      // Status transitions go through the dedicated lifecycle route, which
      // carries companies.disable rather than companies.update.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${tempCompany.id}/status`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', tempCompany.id)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');

      // Cleanup
      await prisma.userBranchRole.deleteMany({ where: { branch_id: tempBranch.id } });
      await prisma.rolePermission.deleteMany({ where: { role_id: tempRole.id } });
      await prisma.role.delete({ where: { id: tempRole.id } });
      await prisma.branch.delete({ where: { id: tempBranch.id } });
      await purgeAuditLogs(prisma);
      await prisma.companyMembership.delete({ where: { id: tempMembership.id } });
      await prisma.company.delete({ where: { id: tempCompany.id } });
    });

    it('9. company cannot be physically deleted through normal API (no DELETE endpoint)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect([404, 405]).toContain(res.status);
    });

  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY CREATION — a platform operation (CC-1..9)
  //
  // Being signed in is not authorization. Only an ACTIVE platform administrator
  // may create a company; company roles held anywhere, and X-Company-ID, are
  // irrelevant. A refused attempt must leave no company behind.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Company creation authorization', () => {
    const create = (token: string, name: string, companyHeader?: string) => {
      const req = request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${token}`);
      if (companyHeader) req.set('X-Company-ID', companyHeader);
      return req.send({ name });
    };

    const expectNoCompanyNamed = async (name: string) => {
      expect(await prisma.company.count({ where: { name } })).toBe(0);
    };

    it('CC-1. unauthenticated creation is refused with 401', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/companies').send({ name: 'CC Anonymous' });
      expect(res.status).toBe(401);
      await expectNoCompanyNamed('CC Anonymous');
    });

    it('CC-2. an ordinary signed-in user with no membership is refused with 403', async () => {
      const res = await create(noMemberToken, 'CC No Member');
      expect(res.status).toBe(403);
      await expectNoCompanyNamed('CC No Member');
    });

    it('CC-3. a member with an unrelated role is refused', async () => {
      const res = await create(restrictedToken, 'CC Restricted');
      expect(res.status).toBe(403);
      await expectNoCompanyNamed('CC Restricted');
    });

    it('CC-4. a company administrator holding every company permission is still refused', async () => {
      const res = await create(adminTokenA, 'CC Company Admin', companyA.id);
      expect(res.status).toBe(403);
      await expectNoCompanyNamed('CC Company Admin');
    });

    it('CC-5. naming another company in X-Company-ID does not help a cross-company admin', async () => {
      const res = await create(adminTokenB, 'CC Cross Company', companyA.id);
      expect(res.status).toBe(403);
      await expectNoCompanyNamed('CC Cross Company');
    });

    it('CC-6. is_superadmin cannot be smuggled in the request body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${noMemberToken}`)
        .send({ name: 'CC Smuggled', is_superadmin: true });
      expect([400, 403]).toContain(res.status);
      await expectNoCompanyNamed('CC Smuggled');
      const user = await prisma.user.findUnique({ where: { email: 'nomember@test.com' } });
      expect(user!.is_superadmin).toBe(false);
    });

    it('CC-7. an ACTIVE platform administrator creates a company, becomes its first member, and it is audited', async () => {
      const res = await create(superadminToken, 'New SaaS Company');

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New SaaS Company');
      expect(res.body.status).toBe(CompanyStatus.ACTIVE);

      const superadmin = await prisma.user.findUnique({ where: { email: 'superadmin@samco.com' } });
      const membership = await prisma.companyMembership.findUnique({
        where: { user_id_company_id: { user_id: superadmin!.id, company_id: res.body.id } },
      });
      expect(membership!.status).toBe(MembershipStatus.ACTIVE);

      const audit = await prisma.auditLog.findFirst({
        where: { company_id: res.body.id, entity_type: 'COMPANY', event_type: 'CREATE' },
      });
      expect(audit!.user_id).toBe(superadmin!.id);

      // Membership without roles grants nothing inside the new company either.
      const update = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${res.body.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('X-Company-ID', res.body.id)
        .send({ name: 'Renamed' });
      expect(update.status).toBe(403);

      // Cleanup
      await purgeAuditLogs(prisma);
      await prisma.companyMembership.delete({ where: { id: membership!.id } });
      await prisma.company.delete({ where: { id: res.body.id } });
    });

    it('CC-8. a platform administrator whose account is disabled cannot create a company', async () => {
      const disabled = await prisma.user.create({
        data: {
          email: 'cc-disabled-platform@samco.com',
          password_hash: await bcrypt.hash(PASSWORD, SALT),
          is_superadmin: true,
        },
      });
      const token = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: disabled.email, password: PASSWORD })
        .then((r) => r.body.accessToken as string);
      await prisma.user.update({ where: { id: disabled.id }, data: { status: 'INACTIVE' } });

      const res = await create(token, 'CC Disabled Platform');
      expect([401, 403]).toContain(res.status);
      await expectNoCompanyNamed('CC Disabled Platform');

      await purgeAuditLogs(prisma);
      await prisma.userSession.deleteMany({ where: { user_id: disabled.id } });
      await prisma.user.delete({ where: { id: disabled.id } });
    });

    it('CC-9. existing company authorization is unchanged: the admin still updates their own company', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Alpha Corp' });
      expect(res.status).toBe(200);

      // …and the platform flag still opens no existing company.
      const peek = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${superadminToken}`);
      expect(peek.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH MANAGEMENT (10–20)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Branch Management', () => {
    let createdBranchId: string;

    it('10. authorized user can list branches in their company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((b: any) => b.id);
      expect(ids).toContain(branchA.id);
      expect(ids).not.toContain(branchB.id); // branchB belongs to companyB
    });

    it('10b. authorized user can list branches in their company via nested route', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}/branches`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((b: any) => b.id);
      expect(ids).toContain(branchA.id);
      expect(ids).not.toContain(branchB.id);
      for (const branch of res.body) {
        expect(branch.company_id).toBe(companyA.id);
      }
    });

    it('10c. nested branch list rejects missing authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}/branches`);

      expect(res.status).toBe(401);
    });

    it('10d. nested branch list rejects cross-company access', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}/branches`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id);

      expect(res.status).toBe(403);
    });

    it('10e. nested branch list rejects mismatched X-Company-ID context', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}/branches`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });

    it('11. user cannot list branches from another company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id); // adminUserA has no membership in companyB

      expect(res.status).toBe(403);
    });

    it('12. authorized user can retrieve a branch in their company', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(branchA.id);
      expect(res.body.company_id).toBe(companyA.id);
    });

    it('13. user cannot retrieve a branch from another company (404)', async () => {
      // adminUserA tries to access branchB (companyB) using companyA context
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(404);
    });

    it('14. authorized user can create a branch in their company', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Alpha Branch 2', timezone: 'Europe/London' });

      expect(res.status).toBe(201);
      expect(res.body.company_id).toBe(companyA.id);
      expect(res.body.name).toBe('Alpha Branch 2');
      expect(res.body.timezone).toBe('Europe/London');
      createdBranchId = res.body.id;
    });

    it('15. user cannot create a branch in another company', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id) // no membership here
        .send({ name: 'Unauthorized Branch', timezone: 'UTC' });

      expect(res.status).toBe(403);
    });

    it('16. branch company ownership cannot be changed via PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ company_id: companyB.id, name: 'Moved' }); // company_id in body

      // ValidationPipe whitelist strips unknown fields; company_id is not in UpdateBranchDto
      // So the request either succeeds without changing company_id, or is rejected
      if (res.status === 200) {
        expect(res.body.company_id).toBe(companyA.id); // company_id must NOT have changed
      } else {
        expect(res.status).toBe(400); // forbidden field rejected
      }

      // Verify in DB that company_id is unchanged
      const branch = await prisma.branch.findUnique({ where: { id: branchA.id } });
      expect(branch!.company_id).toBe(companyA.id);
    });

    it('17. valid IANA timezone is accepted', async () => {
      const timezones = ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/Paris', 'UTC', 'Africa/Lagos'];
      for (const tz of timezones) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/branches')
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .send({ name: `Branch-${tz}`, timezone: tz });

        expect(res.status).toBe(201);
        await purgeAuditLogs(prisma);
        await prisma.branch.delete({ where: { id: res.body.id } });
      }
    });

    it('18. invalid timezone is rejected with 400', async () => {
      const invalidTimezones = ['Not/ATimezone', 'Asia/Fake', 'invalid', 'GMT+9:30'];
      for (const tz of invalidTimezones) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/branches')
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .send({ name: 'Bad TZ Branch', timezone: tz });

        expect(res.status).toBe(400);
      }
    });

    it('19. branch status can be changed via PATCH', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');

      // Restore
      await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.ACTIVE } });
    });

    it('19b. banquet bill terms are saved trimmed, cleared by an empty value, capped, and audited without the text', async () => {
      const patch = (body: Record<string, unknown>, token = adminTokenA) =>
        request(app.getHttpServer())
          .patch(`/api/v1/branches/${branchA.id}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Company-ID', companyA.id)
          .send(body);
      const startedAt = new Date();

      const saved = await patch({ banquet_terms: '  Advance is non-refundable.  ' });
      expect(saved.status).toBe(200);
      expect(saved.body.banquet_terms).toBe('Advance is non-refundable.');

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'BRANCH', entity_id: branchA.id, created_at: { gte: startedAt } },
        orderBy: { created_at: 'desc' },
      });
      expect(audit!.payload).toMatchObject({ banquet_terms_changed: true, banquet_terms_length: 26 });
      expect(JSON.stringify(audit!.payload)).not.toContain('non-refundable');

      expect((await patch({ banquet_terms: 'x'.repeat(4001) })).status).toBe(400);
      expect((await patch({ banquet_terms: 42 })).status).toBe(400);
      await expect(
        prisma.branch.update({ where: { id: branchA.id }, data: { banquet_terms: 'y'.repeat(4001) } }),
      ).rejects.toThrow(/branches_banquet_terms_length/);

      // Without branches.update, and from another company, nothing changes.
      expect((await patch({ banquet_terms: 'Hijacked' }, restrictedToken)).status).toBe(403);
      const cross = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .set('X-Company-ID', companyB.id)
        .send({ banquet_terms: 'Hijacked' });
      expect(cross.status).toBe(404);

      const cleared = await patch({ banquet_terms: '   ' });
      expect(cleared.status).toBe(200);
      expect(cleared.body.banquet_terms).toBeNull();
    });

    it('20. branch cannot be physically deleted through normal API (no DELETE endpoint)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect([404, 405]).toContain(res.status);

      // Cleanup created branch
      if (createdBranchId) {
        await purgeAuditLogs(prisma);
        await prisma.branch.delete({ where: { id: createdBranchId } });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMBERSHIP MANAGEMENT (21–26)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Membership Management', () => {
    let createdMembershipId: string;

    it('21. authorized company administrator can add a user to their company', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyA.id}/members`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ user_id: extraUser.id });

      expect(res.status).toBe(201);
      expect(res.body.user_id).toBe(extraUser.id);
      expect(res.body.company_id).toBe(companyA.id);
      expect(res.body.status).toBe('ACTIVE');
      createdMembershipId = res.body.id;
    });

    it('22. duplicate membership returns 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyA.id}/members`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ user_id: extraUser.id }); // already added in test 21

      expect(res.status).toBe(409);
    });

    it('23. user without memberships.create cannot add members', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyA.id}/members`)
        .set('Authorization', `Bearer ${restrictedToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ user_id: extraUser.id });

      expect(res.status).toBe(403);
    });

    it('23b. user cannot create membership for another company they are not admin of', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyB.id}/members`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id) // adminUserA has no membership here
        .send({ user_id: extraUser.id });

      expect(res.status).toBe(403);
    });

    it('24. unauthorized user cannot modify memberships', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/${createdMembershipId}`)
        .set('Authorization', `Bearer ${restrictedToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(403);
    });

    it('25. membership can be deactivated', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/${createdMembershipId}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('INACTIVE');
    });

    it('26. inactive membership no longer grants company access (GET /companies filtered)', async () => {
      // extraUser now has INACTIVE membership in companyA (deactivated in test 25)
      const extraToken = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'extra@test.com', password: PASSWORD })
      ).body.accessToken;

      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${extraToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.map((c: any) => c.id);
      expect(ids).not.toContain(companyA.id); // INACTIVE → not listed
    });

    it('member list is scoped to the authorized company', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}/members`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // All returned memberships must belong to companyA
      for (const m of res.body) {
        expect(m.company_id).toBe(companyA.id);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-COMPANY SECURITY (27–31)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Cross-Company Security', () => {
    it('27. companyA user cannot access companyB data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(404);
    });

    it('28. companyA branch cannot be manipulated through companyB context', async () => {
      // adminUserB (companyB) tries to update branchA (companyA) using companyB context
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .set('X-Company-ID', companyB.id)
        .send({ name: 'Cross-company hack' });

      // branchA.company_id !== companyB.id → service returns 404
      expect(res.status).toBe(404);
    });

    it('29. branch from companyB cannot be accessed via companyA context', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${branchB.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(404); // branchB.company_id !== companyA.id
    });

    it('30. companyA membership endpoint cannot be accessed with companyB context', async () => {
      // URL uses companyA.id but X-Company-ID is companyB.id
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyA.id}/members`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .set('X-Company-ID', companyB.id);

      // adminTokenB is authorized in companyB, but URL says companyA → mismatch
      expect(res.status).toBe(403);
    });

    it('31. cross-company membership manipulation is rejected', async () => {
      // adminUserA tries to add extraUser to companyB via companyA auth context
      const res = await request(app.getHttpServer())
        .post(`/api/v1/companies/${companyB.id}/members`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id) // authorized in A, targeting B
        .send({ user_id: extraUser.id });

      // URL companyId (B) !== X-Company-ID (A) → rejected
      expect(res.status).toBe(403);
    });

    it('branch listing returns only branches for the authorized company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      const companyIds = res.body.map((b: any) => b.company_id);
      // All branches must belong to companyA
      for (const cid of companyIds) {
        expect(cid).toBe(companyA.id);
      }
    });
  });
});

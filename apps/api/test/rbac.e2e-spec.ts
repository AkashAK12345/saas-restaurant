/**
 * RBAC E2E Test Suite
 *
 * Covers all 35 required test cases for Users, Roles, Permissions,
 * UserBranchRole assignment, authorization scoping, and security invariants.
 *
 * Test database state is set up directly via PrismaService (not via API),
 * since Company/Branch CRUD is not yet implemented.
 *
 * Data layout:
 *
 *   companyA ─ branchA ─ adminRoleA  (users.view, users.create, users.update, roles.view, roles.create, roles.update)
 *            │          └ cashierRoleA (pos.order.create)
 *            └ branchA2 (second branch in same company)
 *
 *   companyB ─ branchB ─ adminRoleB  (users.view, roles.view)
 *
 *   Users:
 *     adminUser       → ACTIVE member of companyA, holds adminRoleA at branchA
 *     cashierUser     → ACTIVE member of companyA, holds cashierRoleA at branchA (no user/role perms)
 *     multiRoleUser   → ACTIVE member of companyA, holds cashierRoleA + adminRoleA at branchA
 *     noMemberUser    → no CompanyMembership at all
 *     superadminUser  → is_superadmin=true, NO CompanyMembership
 *     companyBUser    → ACTIVE member of companyB, holds adminRoleB at branchB
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import {
  resetDatabase,
  purgeAuditLogs,
  assertPermissionsSeeded,
  deleteUserCascade,
} from './utils/db.js';
import * as bcrypt from 'bcrypt';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { MembershipStatus, CompanyStatus, BranchStatus } from '@samco/database';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SALT = 10;
const PASSWORD = 'SecurePassword123!';

async function hashPwd(pwd: string) {
  return bcrypt.hash(pwd, SALT);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Entities created in beforeAll
  let companyA: any;
  let companyB: any;
  let branchA: any;
  let branchA2: any;
  let branchB: any;
  let adminRoleA: any;
  let cashierRoleA: any;
  let adminRoleB: any;

  // Users
  let adminUser: any;
  let cashierUser: any;
  let multiRoleUser: any;
  let noMemberUser: any;
  let companyBUser: any;

  // Tokens
  let adminToken: string;
  let cashierToken: string;
  let superadminToken: string;
  let companyBToken: string;

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

    // ── Clean up (order matters due to FK constraints) ──────────────────────
    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);
    // Note: permissions are NOT deleted — they were seeded and are system-defined

    // ── Companies ───────────────────────────────────────────────────────────
    companyA = await prisma.company.create({
      data: { name: 'Company Alpha', status: CompanyStatus.ACTIVE },
    });
    companyB = await prisma.company.create({
      data: { name: 'Company Beta', status: CompanyStatus.ACTIVE },
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
    branchA2 = await prisma.branch.create({
      data: {
        company_id: companyA.id,
        name: 'Alpha Branch 2',
        timezone: 'Asia/Kolkata',
        status: BranchStatus.ACTIVE,
      },
    });
    branchB = await prisma.branch.create({
      data: {
        company_id: companyB.id,
        name: 'Beta HQ',
        timezone: 'Asia/Kolkata',
        status: BranchStatus.ACTIVE,
      },
    });

    // ── Roles ────────────────────────────────────────────────────────────────
    adminRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Admin', description: 'Full admin' },
    });
    cashierRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Cashier', description: 'POS cashier' },
    });
    adminRoleB = await prisma.role.create({
      data: { company_id: companyB.id, name: 'Admin', description: 'Beta admin' },
    });

    // ── Permissions ──────────────────────────────────────────────────────────
    // Fetch the seeded permission records needed for test setup
    const perms = await prisma.permission.findMany({
      where: {
        name: {
          in: [
            'users.view', 'users.create', 'users.update',
            'roles.view', 'roles.create', 'roles.update',
            'pos.order.create', 'pos.order.cancel',
          ],
        },
      },
    });
    const permMap = new Map(perms.map((p) => [p.name, p]));

    // adminRoleA gets all user+role management permissions, plus the two POS
    // permissions it hands out in the role-permission tests below.
    //
    // An actor may only grant permissions they themselves hold, so adminUser
    // must hold everything the tests assign through the API. adminRoleA still
    // deliberately excludes high-value permissions (pos.refund, audit_logs.view,
    // companies.update, memberships.*) so escalation attempts remain testable.
    await prisma.rolePermission.createMany({
      data: [
        { role_id: adminRoleA.id, permission_id: permMap.get('users.view')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('users.create')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('users.update')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('roles.view')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('roles.create')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('roles.update')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('pos.order.create')!.id },
        { role_id: adminRoleA.id, permission_id: permMap.get('pos.order.cancel')!.id },
      ],
    });

    // cashierRoleA gets only pos.order.create
    await prisma.rolePermission.createMany({
      data: [
        { role_id: cashierRoleA.id, permission_id: permMap.get('pos.order.create')!.id },
      ],
    });

    // adminRoleB for companyB
    await prisma.rolePermission.createMany({
      data: [
        { role_id: adminRoleB.id, permission_id: permMap.get('users.view')!.id },
        { role_id: adminRoleB.id, permission_id: permMap.get('roles.view')!.id },
      ],
    });

    // ── Users ────────────────────────────────────────────────────────────────
    const pwdHash = await hashPwd(PASSWORD);

    adminUser = await prisma.user.create({
      data: { email: 'admin@alpha.com', password_hash: pwdHash, first_name: 'Admin', last_name: 'Alpha' },
    });
    cashierUser = await prisma.user.create({
      data: { email: 'cashier@alpha.com', password_hash: pwdHash, first_name: 'Cashier', last_name: 'Alpha' },
    });
    multiRoleUser = await prisma.user.create({
      data: { email: 'multi@alpha.com', password_hash: pwdHash, first_name: 'Multi', last_name: 'Alpha' },
    });
    noMemberUser = await prisma.user.create({
      data: { email: 'nomember@test.com', password_hash: pwdHash, first_name: 'No', last_name: 'Member' },
    });
    await prisma.user.create({
      data: {
        email: 'superadmin@samco.com', password_hash: pwdHash,
        first_name: 'Super', last_name: 'Admin', is_superadmin: true,
      },
    });
    companyBUser = await prisma.user.create({
      data: { email: 'admin@beta.com', password_hash: pwdHash, first_name: 'Admin', last_name: 'Beta' },
    });

    // ── Company memberships ──────────────────────────────────────────────────
    await prisma.companyMembership.createMany({
      data: [
        { user_id: adminUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: cashierUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: multiRoleUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: companyBUser.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
      ],
    });

    // ── UserBranchRole assignments ──────────────────────────────────────────
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: adminUser.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: cashierUser.id, branch_id: branchA.id, role_id: cashierRoleA.id },
        { user_id: multiRoleUser.id, branch_id: branchA.id, role_id: cashierRoleA.id },
        { user_id: multiRoleUser.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: companyBUser.id, branch_id: branchB.id, role_id: adminRoleB.id },
      ],
    });

    // ── Login to get tokens ──────────────────────────────────────────────────
    const loginAndGetToken = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD });
      return res.body.accessToken as string;
    };

    adminToken = await loginAndGetToken('admin@alpha.com');
    cashierToken = await loginAndGetToken('cashier@alpha.com');
    superadminToken = await loginAndGetToken('superadmin@samco.com');
    companyBToken = await loginAndGetToken('admin@beta.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. AUTHENTICATION PREREQUISITE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authentication prerequisite (28)', () => {
    it('28. missing authentication returns 401 on a protected route', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. USER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('User Management', () => {
    // ── Test 1: Authorized user can list users within company scope ──────────
    it('1. authorized user can list users within their company scope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((u: any) => u.id);
      // Should include companyA members
      expect(ids).toContain(adminUser.id);
      expect(ids).toContain(cashierUser.id);
      // Should NOT include companyB user or noMemberUser
      expect(ids).not.toContain(companyBUser.id);
      expect(ids).not.toContain(noMemberUser.id);
    });

    // ── Test 2: Unauthorized user cannot list users ──────────────────────────
    it('2. user without users.view cannot list users (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });

    // ── Test 26: Correct permission allows access ────────────────────────────
    it('26. correct permission allows protected endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
    });

    // ── Test 27: Missing permission returns 403 ──────────────────────────────
    it('27. missing permission returns 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });

    // ── Test 29: Wrong company context is rejected ───────────────────────────
    it('29. wrong company context (companyA user sending companyB ID) returns 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyB.id); // adminUser has no membership in companyB

      expect(res.status).toBe(403);
    });

    // ── Test 31: Cross-company access is rejected ────────────────────────────
    it('31. companyB user cannot access companyA data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${companyBToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });

    // ── Missing X-Company-ID returns 403 ─────────────────────────────────────
    it('company-scoped endpoint works with company context but without branch context', async () => {
      // This test verifies that branch context is NOT required for company-scoped endpoints
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);
      // Should succeed without X-Branch-ID
      expect(res.status).toBe(200);
    });

    it('missing X-Company-ID returns 403 on company-scoped endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    // ── Test 3: Authorized user can retrieve a user within scope ─────────────
    it('3. authorized user can retrieve a user within scope', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${cashierUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(cashierUser.id);
      expect(res.body).not.toHaveProperty('password_hash');
    });

    // ── Test 4: Cross-company user retrieval is rejected ─────────────────────
    it('4. retrieving a user from another company returns 404', async () => {
      // adminUser from companyA tries to read companyBUser
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${companyBUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(404);
    });

    // ── Test 5, 6, 7, 8: User creation ──────────────────────────────────────
    it('5. created user has a hashed password (not plaintext)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'newuser1@test.com', password: 'Password123!' });

      expect(res.status).toBe(201);

      // Verify password was actually hashed in DB
      const dbUser = await prisma.user.findUnique({ where: { email: 'newuser1@test.com' } });
      expect(dbUser!.password_hash).not.toBe('Password123!');
      const isHashed = await bcrypt.compare('Password123!', dbUser!.password_hash);
      expect(isHashed).toBe(true);

      // Clean up (the created user now also owns a CompanyMembership)
      await deleteUserCascade(prisma, dbUser!.id);
    });

    it('6. password_hash is never returned in API response', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'newuser2@test.com', password: 'Password123!' });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('password_hash');

      const created2 = await prisma.user.findUnique({ where: { email: 'newuser2@test.com' } });
      if (created2) await deleteUserCascade(prisma, created2.id);
    });

    it('7. client cannot set is_superadmin through user creation', async () => {
      // Send is_superadmin: true — the ValidationPipe whitelist strips it
      // OR the service ignores it. Either way, the created user must NOT be a superadmin.
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'newuser3@test.com', password: 'Password123!', is_superadmin: true });

      // ValidationPipe with forbidNonWhitelisted returns 400, OR the field is stripped
      // Either behavior is correct — we just verify the user is never created as superadmin
      if (res.status === 201) {
        const dbUser = await prisma.user.findUnique({ where: { email: 'newuser3@test.com' } });
        expect(dbUser!.is_superadmin).toBe(false);
        await deleteUserCascade(prisma, dbUser!.id);
      } else {
        // 400 is also acceptable — the field is rejected outright
        expect(res.status).toBe(400);
      }
    });

    it('8. invalid email is rejected with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'not-a-valid-email', password: 'Password123!' });

      expect(res.status).toBe(400);
    });

    // ── Test 33: is_superadmin cannot be set ─────────────────────────────────
    it('33. is_superadmin cannot be set through normal user API', async () => {
      // Same as test 7 — explicit check via PATCH too
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${cashierUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ is_superadmin: true });

      // Either rejected by whitelist (400) or the field is silently ignored
      if (res.status === 200) {
        const dbUser = await prisma.user.findUnique({ where: { id: cashierUser.id } });
        expect(dbUser!.is_superadmin).toBe(false);
      } else {
        expect(res.status).toBe(400);
      }
    });

    // ── Test 34: password_hash cannot be supplied ─────────────────────────────
    it('34. password_hash cannot be supplied in user creation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'badactor@test.com', password: 'Password123!', password_hash: 'my_evil_hash' });

      // Either rejected (400) or the field is stripped (201 with correct hash)
      if (res.status === 201) {
        const dbUser = await prisma.user.findUnique({ where: { email: 'badactor@test.com' } });
        expect(dbUser!.password_hash).not.toBe('my_evil_hash');
        await deleteUserCascade(prisma, dbUser!.id);
      } else {
        expect(res.status).toBe(400);
      }
    });

    // ── Test 32: Frontend cannot bypass authorization via direct API call ─────
    it('32. client cannot bypass authorization by calling API without token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({ email: 'bypass@test.com', password: 'Password123!' });

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ROLES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Role Management', () => {
    let createdRole: any;

    // ── Test 9: Authorized user can create a role ────────────────────────────
    it('9. authorized user can create a role in their company', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Supervisor', description: 'Floor supervisor' });

      expect(res.status).toBe(201);
      expect(res.body.company_id).toBe(companyA.id);
      expect(res.body.name).toBe('Supervisor');
      createdRole = res.body;
    });

    // ── Test 10: Role cannot be created without proper authorization ──────────
    it('10. user without roles.create cannot create a role (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Supervisor2' });

      expect(res.status).toBe(403);
    });

    // ── Test 11: Role from another company cannot be retrieved ───────────────
    it('11. role from another company cannot be retrieved (404)', async () => {
      // adminUser from companyA tries to read adminRoleB (companyB)
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${adminRoleB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(404);
    });

    // ── Test 12: Role from another company cannot be modified ────────────────
    it('12. role from another company cannot be modified (404)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${adminRoleB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(404);
    });

    // ── List roles scoped to company ─────────────────────────────────────────
    it('GET /roles returns only roles for the authorized company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      const roleIds = res.body.map((r: any) => r.id);
      // Must not return companyB's role
      expect(roleIds).not.toContain(adminRoleB.id);
    });

    // ── Clean up created role ────────────────────────────────────────────────
    afterAll(async () => {
      if (createdRole) {
        await prisma.role.deleteMany({ where: { id: createdRole.id } });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Role-Permission Management', () => {
    let testRole: any;

    beforeAll(async () => {
      testRole = await prisma.role.create({
        data: { company_id: companyA.id, name: 'PermTestRole' },
      });
      // Assign this role to adminUser at branchA so they have permission to manage it
      // (adminUser already has roles.update via adminRoleA — this is just the target role)
    });

    afterAll(async () => {
      await prisma.rolePermission.deleteMany({ where: { role_id: testRole.id } });
      await prisma.role.delete({ where: { id: testRole.id } });
    });

    // ── Test 13: Valid system permission can be assigned ─────────────────────
    it('13. valid system permission can be assigned to a role', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.order.create', 'pos.order.cancel'] });

      expect(res.status).toBe(200);
      const permNames = res.body.permissions.map((rp: any) => rp.permission.name);
      expect(permNames).toContain('pos.order.create');
      expect(permNames).toContain('pos.order.cancel');
    });

    // ── Test 14: Invalid permission is rejected ──────────────────────────────
    it('14. invalid/nonexistent permission name is rejected with 400', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.order.create', 'totally.fake.permission'] });

      expect(res.status).toBe(400);
    });

    // ── Test 15: Cross-company role manipulation is rejected ─────────────────
    it('15. cross-company role permission manipulation is rejected (404)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${adminRoleB.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.order.create'] });

      expect(res.status).toBe(404);
    });

    // ── Test 16: Permission removal works correctly ───────────────────────────
    it('16. setting an empty permissions array clears all permissions', async () => {
      // First assign some
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.order.create'] });

      // Then clear
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: [] });

      expect(res.status).toBe(200);
      expect(res.body.permissions).toHaveLength(0);
    });

    // ── Test 36: Users cannot create arbitrary permission definitions ─────────
    it('36. users cannot create arbitrary permission definitions', async () => {
      // The PUT endpoint only accepts existing system-defined permissions.
      // There is no API endpoint to create new Permission records.
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['arbitrary.made.up.permission'] });

      expect(res.status).toBe(400);
    });

    // ── Test 35: Users cannot assign permissions they don't manage ────────────
    it('35. user without roles.update cannot assign permissions to a role', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.order.create'] });

      expect(res.status).toBe(403);
    });

    // ═════════════════════════════════════════════════════════════════════════
    // C1 REGRESSION — roles.update must not permit privilege self-escalation
    //
    // adminUser holds: users.*, roles.*, pos.order.create, pos.order.cancel
    // adminUser does NOT hold: pos.refund, audit_logs.view, companies.update
    // ═════════════════════════════════════════════════════════════════════════

    it('C1-a. cannot grant a permission the actor does not hold', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.refund'] });

      expect(res.status).toBe(403);

      // Nothing was persisted
      const rows = await prisma.rolePermission.findMany({
        where: { role_id: testRole.id, permission: { name: 'pos.refund' } },
      });
      expect(rows).toHaveLength(0);
    });

    it('C1-b. cannot self-escalate by writing a new permission onto own role', async () => {
      // adminUser holds adminRoleA. They lack audit_logs.view.
      const before = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);
      expect(before.status).toBe(403);

      const escalate = await request(app.getHttpServer())
        .put(`/api/v1/roles/${adminRoleA.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({
          permissions: [
            'users.view', 'users.create', 'users.update',
            'roles.view', 'roles.create', 'roles.update',
            'pos.order.create', 'pos.order.cancel',
            'audit_logs.view', // ← the escalation attempt
          ],
        });
      expect(escalate.status).toBe(403);

      // Effective privilege is unchanged
      const after = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);
      expect(after.status).toBe(403);
    });

    it('C1-c. a partially-disallowed batch is rejected atomically', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        // users.view is held; companies.update is not
        .send({ permissions: ['users.view', 'companies.update'] });

      expect(res.status).toBe(403);

      // Neither permission was written
      const rows = await prisma.rolePermission.findMany({
        where: { role_id: testRole.id },
      });
      expect(rows).toHaveLength(0);
    });

    it('C1-d. legitimate assignment of held permissions still succeeds', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['users.view', 'pos.order.create'] });

      expect(res.status).toBe(200);
      const names = res.body.permissions.map((rp: any) => rp.permission.name);
      expect(names).toContain('users.view');
      expect(names).toContain('pos.order.create');

      // Reset for later tests in this block
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: [] });
    });

    it('C1-e. permission-name validation still runs (unknown name → 400)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['users.view', 'not.a.real.permission'] });

      expect(res.status).toBe(400);
    });

    it('C1-f. an existing permission the actor lacks may be RETAINED (not an escalation)', async () => {
      // Seed a role that already outranks adminUser.
      const outrankingRole = await prisma.role.create({
        data: { company_id: companyA.id, name: 'OutrankingRole' },
      });
      const refund = await prisma.permission.findUnique({ where: { name: 'pos.refund' } });
      await prisma.rolePermission.create({
        data: { role_id: outrankingRole.id, permission_id: refund!.id },
      });

      // Keeping pos.refund while adding a held permission is allowed:
      // the actor introduces nothing they do not already have.
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${outrankingRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.refund', 'users.view'] });

      expect(res.status).toBe(200);
      const names = res.body.permissions.map((rp: any) => rp.permission.name);
      expect(names).toContain('pos.refund');
      expect(names).toContain('users.view');

      // Removing it is also allowed — that is a privilege reduction.
      const removed = await request(app.getHttpServer())
        .put(`/api/v1/roles/${outrankingRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['users.view'] });
      expect(removed.status).toBe(200);

      // ...but it can never be re-added, since the actor still does not hold it.
      const reAdd = await request(app.getHttpServer())
        .put(`/api/v1/roles/${outrankingRole.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['users.view', 'pos.refund'] });
      expect(reAdd.status).toBe(403);

      await prisma.rolePermission.deleteMany({ where: { role_id: outrankingRole.id } });
      await purgeAuditLogs(prisma);
      await prisma.role.delete({ where: { id: outrankingRole.id } });
    });

    it('C1-g. is_superadmin does not bypass the permission-grant restriction', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${testRole.id}/permissions`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ permissions: ['pos.refund'] });

      // Rejected at the guard — superadmin has no membership and no permissions
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. USER-BRANCH-ROLE ASSIGNMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('User-Branch-Role Assignment', () => {
    let targetRole: any;
    let targetUser: any;
    let createdAssignment: any;

    beforeAll(async () => {
      targetRole = await prisma.role.create({
        data: { company_id: companyA.id, name: 'AssignTestRole' },
      });
      targetUser = await prisma.user.create({
        data: { email: 'assigntarget@test.com', password_hash: await hashPwd(PASSWORD) },
      });
      await prisma.companyMembership.create({
        data: { user_id: targetUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
    });

    afterAll(async () => {
      await prisma.userBranchRole.deleteMany({ where: { user_id: targetUser.id } });
      await prisma.companyMembership.deleteMany({ where: { user_id: targetUser.id } });
      await prisma.user.delete({ where: { id: targetUser.id } });
      await prisma.rolePermission.deleteMany({ where: { role_id: targetRole.id } });
      await prisma.role.delete({ where: { id: targetRole.id } });
    });

    // ── Test 17: Valid assignment succeeds ───────────────────────────────────
    it('17. valid user + branch + role assignment succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)   // operator's branch context for permission check
        .send({ branch_id: branchA.id, role_id: targetRole.id });

      expect(res.status).toBe(201);
      expect(res.body.user_id).toBe(targetUser.id);
      expect(res.body.branch_id).toBe(branchA.id);
      expect(res.body.role_id).toBe(targetRole.id);
      createdAssignment = res.body;
    });

    // ── Test 21: Duplicate assignment is idempotent ──────────────────────────
    it('21. duplicate role assignment returns the existing assignment (idempotent)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: targetRole.id });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(createdAssignment.id);
    });

    // ── Test 30: Wrong branch context (branch belongs to another company) ─────
    it('30. branch belonging to another company is rejected as branch context', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchB.id)  // branchB belongs to companyB — guard rejects this
        .send({ branch_id: branchA.id, role_id: targetRole.id });

      expect(res.status).toBe(403);
    });

    // ── Test 19: Branch from another company cannot be assigned ─────────────
    // The body branch_id must equal the authorized X-Branch-ID, so a foreign
    // branch in the body is now rejected as a branch-context mismatch (403)
    // before the cross-company ownership check (422) is ever reached.
    it('19. branch from another company in body is rejected (403 context mismatch)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchB.id, role_id: targetRole.id }); // branchB is companyB's

      expect(res.status).toBe(403);
    });

    // ── Test 20: Role from another company cannot be assigned ────────────────
    it('20. role from another company in body is rejected (422)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: adminRoleB.id }); // adminRoleB is companyB's

      expect(res.status).toBe(422);
    });

    // ── Test 18: User from another company cannot be assigned ────────────────
    it('18. user without active membership in company cannot be assigned a branch role', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${noMemberUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: targetRole.id }); // noMemberUser has no membership

      expect(res.status).toBe(422);
    });

    // ── S1: role assignment cannot be used to escalate privileges ───────────
    //
    // adminRoleA holds users.update but NOT audit_logs.view. Assigning a role
    // hands over every permission it carries, so users.update must not become
    // a way to hand out (or take) permissions the actor does not hold.
    describe('S1. privilege escalation through role assignment', () => {
      let privilegedRole: any;
      let subsetRole: any;

      beforeAll(async () => {
        const perms = await prisma.permission.findMany({
          where: { name: { in: ['audit_logs.view', 'pos.order.create'] } },
        });
        const byName = new Map(perms.map((p) => [p.name, p.id]));
        privilegedRole = await prisma.role.create({ data: { company_id: companyA.id, name: 'S1 Privileged' } });
        subsetRole = await prisma.role.create({ data: { company_id: companyA.id, name: 'S1 Subset' } });
        await prisma.rolePermission.createMany({
          data: [
            { role_id: privilegedRole.id, permission_id: byName.get('audit_logs.view')! },
            { role_id: subsetRole.id, permission_id: byName.get('pos.order.create')! },
          ],
        });
      });

      afterAll(async () => {
        await prisma.userBranchRole.deleteMany({ where: { role_id: { in: [privilegedRole.id, subsetRole.id] } } });
        await prisma.rolePermission.deleteMany({ where: { role_id: { in: [privilegedRole.id, subsetRole.id] } } });
        await prisma.role.deleteMany({ where: { id: { in: [privilegedRole.id, subsetRole.id] } } });
      });

      const assign = (userId: string, roleId: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/users/${userId}/branch-roles`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Company-ID', companyA.id)
          .set('X-Branch-ID', branchA.id)
          .send({ branch_id: branchA.id, role_id: roleId });

      it('S1-a. cannot assign a role carrying a permission the actor does not hold', async () => {
        const res = await assign(targetUser.id, privilegedRole.id);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('audit_logs.view');
        const written = await prisma.userBranchRole.findFirst({
          where: { user_id: targetUser.id, role_id: privilegedRole.id },
        });
        expect(written).toBeNull();
      });

      it('S1-b. cannot assign any role to themselves, even one within their own permissions', async () => {
        const res = await assign(adminUser.id, subsetRole.id);
        expect(res.status).toBe(403);
        const written = await prisma.userBranchRole.findFirst({
          where: { user_id: adminUser.id, role_id: subsetRole.id },
        });
        expect(written).toBeNull();
      });

      it('S1-c. can still assign a role whose permissions the actor holds', async () => {
        const res = await assign(targetUser.id, subsetRole.id);
        expect(res.status).toBe(201);
      });
    });

    // ── Branch-scoped endpoint requires branch context ────────────────────────
    it('branch-scoped endpoint requires X-Branch-ID header', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${targetUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        // X-Branch-ID deliberately omitted
        .send({ branch_id: branchA.id, role_id: targetRole.id });

      expect(res.status).toBe(403);
    });

    // ── Delete the assignment ────────────────────────────────────────────────
    it('DELETE /users/:id/branch-roles/:assignmentId removes the assignment', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${targetUser.id}/branch-roles/${createdAssignment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);

      expect(res.status).toBe(204);

      // Verify it's gone
      const check = await prisma.userBranchRole.findUnique({
        where: { id: createdAssignment.id },
      });
      expect(check).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C2 / C3 REGRESSION — branch-role assignment and removal must stay inside
  // the branch the PermissionGuard actually authorized.
  //
  // adminUser holds adminRoleA (incl. users.update) at branchA ONLY.
  // They have no role, and therefore no authority, at branchA2 — even though
  // branchA2 belongs to the same company.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Branch-context isolation (C2/C3)', () => {
    let isolationRole: any;
    let isolationUser: any;

    beforeAll(async () => {
      isolationRole = await prisma.role.create({
        data: { company_id: companyA.id, name: 'BranchIsolationRole' },
      });
      isolationUser = await prisma.user.create({
        data: { email: 'branchisolation@test.com', password_hash: await hashPwd(PASSWORD) },
      });
      await prisma.companyMembership.create({
        data: {
          user_id: isolationUser.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });
    });

    afterAll(async () => {
      await prisma.userBranchRole.deleteMany({ where: { user_id: isolationUser.id } });
      await purgeAuditLogs(prisma);
      await prisma.companyMembership.deleteMany({ where: { user_id: isolationUser.id } });
      await prisma.user.delete({ where: { id: isolationUser.id } });
      await prisma.rolePermission.deleteMany({ where: { role_id: isolationRole.id } });
      await prisma.role.delete({ where: { id: isolationRole.id } });
    });

    // ── C2: assignment ───────────────────────────────────────────────────────

    it('C2-a. branchA manager CAN assign a role at branchA', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${isolationUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: isolationRole.id });

      expect(res.status).toBe(201);
      expect(res.body.branch_id).toBe(branchA.id);

      await prisma.userBranchRole.delete({ where: { id: res.body.id } });
    });

    it('C2-b. branchA manager CANNOT assign a role at branchA2 via body branch_id', async () => {
      // Authorized at branchA, attempting to write at branchA2 (same company).
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${isolationUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA2.id, role_id: isolationRole.id });

      expect(res.status).toBe(403);

      // Critically: nothing was written at branchA2
      const leaked = await prisma.userBranchRole.findFirst({
        where: { user_id: isolationUser.id, branch_id: branchA2.id },
      });
      expect(leaked).toBeNull();
    });

    it('C2-c. branchA manager cannot simply switch X-Branch-ID to branchA2', async () => {
      // Making the body match branchA2 requires authorization AT branchA2,
      // which adminUser does not have — the guard rejects it.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${isolationUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA2.id)
        .send({ branch_id: branchA2.id, role_id: isolationRole.id });

      expect(res.status).toBe(403);

      const leaked = await prisma.userBranchRole.findFirst({
        where: { user_id: isolationUser.id, branch_id: branchA2.id },
      });
      expect(leaked).toBeNull();
    });

    it('C2-d. company mismatch in branch context is rejected', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${isolationUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchB.id) // branchB belongs to companyB
        .send({ branch_id: branchB.id, role_id: isolationRole.id });

      expect(res.status).toBe(403);
    });

    it('C2-e. missing branch context is rejected', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${isolationUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ branch_id: branchA.id, role_id: isolationRole.id });

      expect(res.status).toBe(403);
    });

    // ── C3: removal ──────────────────────────────────────────────────────────

    it('C3-a. branchA manager CAN remove a branchA assignment', async () => {
      const assignment = await prisma.userBranchRole.create({
        data: {
          user_id: isolationUser.id,
          branch_id: branchA.id,
          role_id: isolationRole.id,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${isolationUser.id}/branch-roles/${assignment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);

      expect(res.status).toBe(204);
      const gone = await prisma.userBranchRole.findUnique({ where: { id: assignment.id } });
      expect(gone).toBeNull();
    });

    it('C3-b. branchA manager CANNOT remove a branchA2 assignment', async () => {
      const foreign = await prisma.userBranchRole.create({
        data: {
          user_id: isolationUser.id,
          branch_id: branchA2.id,
          role_id: isolationRole.id,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${isolationUser.id}/branch-roles/${foreign.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id); // authority at branchA only

      // 404 rather than 403 — do not disclose assignments at branches the
      // actor has no authority over.
      expect(res.status).toBe(404);

      // The assignment survives
      const survived = await prisma.userBranchRole.findUnique({ where: { id: foreign.id } });
      expect(survived).not.toBeNull();

      await prisma.userBranchRole.delete({ where: { id: foreign.id } });
    });

    it('C3-c. company mismatch on removal is rejected', async () => {
      const assignment = await prisma.userBranchRole.create({
        data: {
          user_id: isolationUser.id,
          branch_id: branchA.id,
          role_id: isolationRole.id,
        },
      });

      // companyBUser attempting to reach into companyA's assignment
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${isolationUser.id}/branch-roles/${assignment.id}`)
        .set('Authorization', `Bearer ${companyBToken}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);

      expect(res.status).toBe(403);

      const survived = await prisma.userBranchRole.findUnique({ where: { id: assignment.id } });
      expect(survived).not.toBeNull();

      await prisma.userBranchRole.delete({ where: { id: assignment.id } });
    });

    it('C3-d. missing branch context on removal is rejected', async () => {
      const assignment = await prisma.userBranchRole.create({
        data: {
          user_id: isolationUser.id,
          branch_id: branchA.id,
          role_id: isolationRole.id,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${isolationUser.id}/branch-roles/${assignment.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);

      const survived = await prisma.userBranchRole.findUnique({ where: { id: assignment.id } });
      expect(survived).not.toBeNull();

      await prisma.userBranchRole.delete({ where: { id: assignment.id } });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. EFFECTIVE PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Effective Permissions', () => {
    // ── Test 22: User with one role receives that role's permissions ──────────
    it("22. user with one role receives that role's permissions", async () => {
      // cashierUser has only cashierRoleA (pos.order.create)
      // They should NOT have users.view
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403); // no users.view
    });

    // ── Test 23: User with multiple roles receives the union ─────────────────
    it('23. user with multiple roles (cashier + admin) receives the UNION of permissions', async () => {
      // multiRoleUser has both cashierRoleA and adminRoleA at branchA
      // So they should have both pos.order.create AND users.view
      const multiToken = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'multi@alpha.com', password: PASSWORD })
      ).body.accessToken;

      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${multiToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
    });

    // ── Test 24: Removing a role removes its effective permissions ───────────
    it('24. removing a role from a user removes its effective permissions', async () => {
      // Create a temporary user with both adminRoleA at branchA
      const tempUser = await prisma.user.create({
        data: { email: 'tempuser24@test.com', password_hash: await hashPwd(PASSWORD) },
      });
      await prisma.companyMembership.create({
        data: { user_id: tempUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      const assignment = await prisma.userBranchRole.create({
        data: { user_id: tempUser.id, branch_id: branchA.id, role_id: adminRoleA.id },
      });

      const tempToken = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'tempuser24@test.com', password: PASSWORD })
      ).body.accessToken;

      // Should have users.view
      const before = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tempToken}`)
        .set('X-Company-ID', companyA.id);
      expect(before.status).toBe(200);

      // Remove the role assignment
      await prisma.userBranchRole.delete({ where: { id: assignment.id } });

      // Now should NOT have users.view
      const after = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tempToken}`)
        .set('X-Company-ID', companyA.id);
      expect(after.status).toBe(403);

      // Cleanup
      await purgeAuditLogs(prisma);
      await prisma.userSession.deleteMany({ where: { user_id: tempUser.id } });
      await prisma.companyMembership.deleteMany({ where: { user_id: tempUser.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
    });

    // ── Test 25: Removing a permission from a role removes that capability ────
    it('25. removing a permission from a role removes the corresponding capability', async () => {
      // Create a test role with users.view, assign to a temp user
      const tempRole = await prisma.role.create({
        data: { company_id: companyA.id, name: 'TempRole25' },
      });
      const usersViewPerm = await prisma.permission.findUnique({ where: { name: 'users.view' } });
      await prisma.rolePermission.create({
        data: { role_id: tempRole.id, permission_id: usersViewPerm!.id },
      });

      const tempUser = await prisma.user.create({
        data: { email: 'tempuser25@test.com', password_hash: await hashPwd(PASSWORD) },
      });
      await prisma.companyMembership.create({
        data: { user_id: tempUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: tempUser.id, branch_id: branchA.id, role_id: tempRole.id },
      });

      const tempToken = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'tempuser25@test.com', password: PASSWORD })
      ).body.accessToken;

      // Has users.view
      const before = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tempToken}`)
        .set('X-Company-ID', companyA.id);
      expect(before.status).toBe(200);

      // Remove the permission from the role
      await prisma.rolePermission.deleteMany({ where: { role_id: tempRole.id } });

      // No longer has users.view
      const after = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tempToken}`)
        .set('X-Company-ID', companyA.id);
      expect(after.status).toBe(403);

      // Cleanup
      await purgeAuditLogs(prisma);
      await prisma.userSession.deleteMany({ where: { user_id: tempUser.id } });
      await prisma.userBranchRole.deleteMany({ where: { user_id: tempUser.id } });
      await prisma.companyMembership.deleteMany({ where: { user_id: tempUser.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
      await prisma.role.delete({ where: { id: tempRole.id } });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. SUPERADMIN SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Superadmin (no automatic bypass)', () => {
    // ── is_superadmin does NOT bypass authorization ───────────────────────────
    it('superadmin flag does NOT automatically bypass authorization guards', async () => {
      // superadminUser has is_superadmin=true but NO CompanyMembership anywhere
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('X-Company-ID', companyA.id);

      // Should be 403 — no membership, no branch roles, no permissions
      expect(res.status).toBe(403);
    });

    it('superadmin cannot access roles without company membership', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${superadminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. BRANCH FILTER ON USER LISTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('User listing with branch filter', () => {
    it('GET /users?branch_id=<id> returns only users with roles at that branch', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ branch_id: branchA.id })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(200);
      const ids = res.body.map((u: any) => u.id);
      expect(ids).toContain(adminUser.id);
      expect(ids).toContain(cashierUser.id);
      // companyBUser has no role at branchA
      expect(ids).not.toContain(companyBUser.id);
    });

    it('branch filter with a branch from another company returns 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ branch_id: branchB.id }) // companyB branch
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(404);
    });
  });
});

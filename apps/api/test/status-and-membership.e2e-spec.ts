/**
 * Phase 1 hardening regressions:
 *
 *   H4 — company / branch status must gate authorization
 *   M2 — membership self-deactivation must not 500 / roll back
 *   M3 — getUser / updateUser require ACTIVE membership
 *   M4 — branch-filtered listUsers ignores non-ACTIVE members
 *   L1 — malformed UUID path params produce 400, never 500
 *   L5 — users.create must not mint orphaned global accounts
 *
 *   REC — company lockout recovery (lifecycle transition authorization)
 *   USR — global user disable, and its separation from company membership
 *
 * Self-contained fixtures so the shared suites stay untouched.
 *
 *   companyA ─ branchA  ─ adminRoleA (full management set)
 *            └ branchA2
 *   companyB ─ branchB  ─ adminRoleB
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import {
  resetDatabase,
  assertPermissionsSeeded,
  deleteUserCascade,
} from './utils/db.js';
import * as bcrypt from 'bcrypt';
import {
  MembershipStatus,
  CompanyStatus,
  BranchStatus,
} from '@samco/database';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const MANAGEMENT_PERMISSIONS = [
  'companies.view', 'companies.update', 'companies.disable',
  'branches.view', 'branches.create', 'branches.update',
  'memberships.view', 'memberships.create', 'memberships.update',
  'users.view', 'users.create', 'users.update', 'users.disable',
  'roles.view', 'roles.create', 'roles.update',
];

// Deliberately excludes companies.disable and users.disable so the
// "authorized vs merely authenticated" boundary is testable.
const RESTRICTED_PERMISSIONS = ['branches.view', 'companies.view', 'users.view'];

describe('Status & Membership hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let companyA: any, companyB: any;
  let branchA: any, branchA2: any, branchB: any;
  let adminRoleA: any, adminRoleB: any, restrictedRoleA: any;
  let adminA: any, adminB: any, memberUser: any, restrictedUser: any;
  let adminTokenA: string, adminTokenB: string, restrictedToken: string;

  const setCompanyStatus = (id: string, status: CompanyStatus) =>
    prisma.company.update({ where: { id }, data: { status } });

  const setBranchStatus = (id: string, status: BranchStatus) =>
    prisma.branch.update({ where: { id }, data: { status } });

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

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const pwdHash = await bcrypt.hash(PASSWORD, SALT);

    companyA = await prisma.company.create({
      data: { name: 'Status Alpha', status: CompanyStatus.ACTIVE },
    });
    companyB = await prisma.company.create({
      data: { name: 'Status Beta', status: CompanyStatus.ACTIVE },
    });

    branchA = await prisma.branch.create({
      data: { company_id: companyA.id, name: 'Alpha HQ', timezone: 'UTC', status: BranchStatus.ACTIVE },
    });
    branchA2 = await prisma.branch.create({
      data: { company_id: companyA.id, name: 'Alpha Two', timezone: 'UTC', status: BranchStatus.ACTIVE },
    });
    branchB = await prisma.branch.create({
      data: { company_id: companyB.id, name: 'Beta HQ', timezone: 'UTC', status: BranchStatus.ACTIVE },
    });

    adminRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Admin' },
    });
    adminRoleB = await prisma.role.create({
      data: { company_id: companyB.id, name: 'Admin' },
    });
    restrictedRoleA = await prisma.role.create({
      data: { company_id: companyA.id, name: 'Restricted' },
    });

    const perms = await prisma.permission.findMany({
      where: { name: { in: MANAGEMENT_PERMISSIONS } },
    });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ role_id: adminRoleA.id, permission_id: p.id })),
    });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ role_id: adminRoleB.id, permission_id: p.id })),
    });

    const restrictedPerms = await prisma.permission.findMany({
      where: { name: { in: RESTRICTED_PERMISSIONS } },
    });
    await prisma.rolePermission.createMany({
      data: restrictedPerms.map((p) => ({
        role_id: restrictedRoleA.id,
        permission_id: p.id,
      })),
    });

    adminA = await prisma.user.create({
      data: { email: 'status-admin-a@test.com', password_hash: pwdHash },
    });
    adminB = await prisma.user.create({
      data: { email: 'status-admin-b@test.com', password_hash: pwdHash },
    });
    memberUser = await prisma.user.create({
      data: { email: 'status-member@test.com', password_hash: pwdHash, first_name: 'Mem' },
    });
    restrictedUser = await prisma.user.create({
      data: { email: 'status-restricted@test.com', password_hash: pwdHash },
    });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: adminA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: adminB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: memberUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: restrictedUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      ],
    });

    await prisma.userBranchRole.createMany({
      data: [
        { user_id: adminA.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: adminB.id, branch_id: branchB.id, role_id: adminRoleB.id },
        { user_id: memberUser.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: restrictedUser.id, branch_id: branchA.id, role_id: restrictedRoleA.id },
      ],
    });

    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
      ).body.accessToken as string;

    adminTokenA = await login('status-admin-a@test.com');
    adminTokenB = await login('status-admin-b@test.com');
    restrictedToken = await login('status-restricted@test.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // H4 — COMPANY / BRANCH STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('H4 — company and branch status gate authorization', () => {
    afterEach(async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.ACTIVE);
      await setBranchStatus(branchA.id, BranchStatus.ACTIVE);
    });

    const listBranches = (token: string, companyId: string) =>
      request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyId);

    it('H4-a. ACTIVE company permits protected operations (baseline)', async () => {
      const res = await listBranches(adminTokenA, companyA.id);
      expect(res.status).toBe(200);
    });

    it('H4-b. INACTIVE company rejects protected reads', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);
      const res = await listBranches(adminTokenA, companyA.id);
      expect(res.status).toBe(403);
    });

    it('H4-c. INACTIVE company rejects protected mutations, and nothing is written', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);

      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Should Not Exist', timezone: 'UTC' });
      expect(res.status).toBe(403);

      const leaked = await prisma.branch.findFirst({
        where: { company_id: companyA.id, name: 'Should Not Exist' },
      });
      expect(leaked).toBeNull();
    });

    it('H4-d. SUSPENDED company rejects protected operations', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.SUSPENDED);
      const res = await listBranches(adminTokenA, companyA.id);
      expect(res.status).toBe(403);
    });

    it('H4-e. reactivation restores authorization', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.SUSPENDED);
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(403);

      await setCompanyStatus(companyA.id, CompanyStatus.ACTIVE);
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(200);
    });

    it('H4-f. authentication is unaffected while the company is disabled', async () => {
      // Login must not become collateral damage of company status.
      await setCompanyStatus(companyA.id, CompanyStatus.SUSPENDED);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'status-admin-a@test.com', password: PASSWORD });
      expect(login.status).toBe(200);

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(me.status).toBe(200);

      // The user can still see the company exists — so they can tell WHY they
      // are locked out instead of it silently vanishing.
      const companies = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(companies.status).toBe(200);
    });

    it('H4-g. disabling one company does not affect another', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);
      const res = await listBranches(adminTokenB, companyB.id);
      expect(res.status).toBe(200);
    });

    it('H4-h. cross-company isolation still holds when status changes', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);
      const res = await listBranches(adminTokenB, companyA.id);
      expect(res.status).toBe(403);
    });

    it('H4-i. INACTIVE branch rejects branch-scoped operations', async () => {
      await setBranchStatus(branchA.id, BranchStatus.INACTIVE);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${memberUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: adminRoleA.id });

      expect(res.status).toBe(403);
    });

    it('H4-j. reactivating the branch restores branch-scoped authorization', async () => {
      await setBranchStatus(branchA.id, BranchStatus.INACTIVE);

      const denied = await request(app.getHttpServer())
        .post(`/api/v1/users/${memberUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA2.id)
        .send({ branch_id: branchA2.id, role_id: adminRoleA.id });
      // adminA holds no role at branchA2 either, so this is 403 regardless —
      // use branchA itself for the positive case below.
      expect(denied.status).toBe(403);

      await setBranchStatus(branchA.id, BranchStatus.ACTIVE);

      const allowed = await request(app.getHttpServer())
        .post(`/api/v1/users/${memberUser.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: adminRoleA.id });
      // memberUser already holds adminRoleA at branchA — idempotent success.
      expect(allowed.status).toBe(201);
    });

    it('H4-k. a disabled branch does NOT strip company-scoped permissions', async () => {
      // Deliberate: otherwise disabling a company's only branch would remove the
      // branches.update needed to bring it back.
      await setBranchStatus(branchA.id, BranchStatus.INACTIVE);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branchA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // M2 — MEMBERSHIP SELF-DEACTIVATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('M2 — membership self-deactivation', () => {
    it('M2-a. deactivating your own membership succeeds instead of 500-ing', async () => {
      const selfUser = await prisma.user.create({
        data: {
          email: 'self-deactivate@test.com',
          password_hash: await bcrypt.hash(PASSWORD, SALT),
        },
      });
      const membership = await prisma.companyMembership.create({
        data: {
          user_id: selfUser.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      await prisma.userBranchRole.create({
        data: { user_id: selfUser.id, branch_id: branchA.id, role_id: adminRoleA.id },
      });

      const token = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'self-deactivate@test.com', password: PASSWORD })
      ).body.accessToken;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: MembershipStatus.INACTIVE });

      // Previously 500: the audit write re-read the actor's own membership
      // inside the transaction, saw INACTIVE, threw, and rolled the whole
      // mutation back.
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(MembershipStatus.INACTIVE);

      // The mutation actually committed...
      const after = await prisma.companyMembership.findUnique({
        where: { id: membership.id },
      });
      expect(after!.status).toBe(MembershipStatus.INACTIVE);

      // ...and its audit record committed with it (atomicity preserved).
      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'COMPANY_MEMBERSHIP', entity_id: membership.id },
      });
      expect(audit).not.toBeNull();

      // The now-inactive member immediately loses access.
      const denied = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyA.id);
      expect(denied.status).toBe(403);

      await deleteUserCascade(prisma, selfUser.id);
    });

    it('M2-b. deactivating another member still works and revokes their access', async () => {
      const victim = await prisma.user.create({
        data: {
          email: 'deactivate-target@test.com',
          password_hash: await bcrypt.hash(PASSWORD, SALT),
        },
      });
      const membership = await prisma.companyMembership.create({
        data: {
          user_id: victim.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      await prisma.userBranchRole.create({
        data: { user_id: victim.id, branch_id: branchA.id, role_id: adminRoleA.id },
      });

      const victimToken = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'deactivate-target@test.com', password: PASSWORD })
      ).body.accessToken;

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/branches')
            .set('Authorization', `Bearer ${victimToken}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/${membership.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: MembershipStatus.INACTIVE });
      expect(res.status).toBe(200);

      const denied = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${victimToken}`)
        .set('X-Company-ID', companyA.id);
      expect(denied.status).toBe(403);

      await deleteUserCascade(prisma, victim.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // M3 / M4 — ACTIVE MEMBERSHIP ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('M3/M4 — inactive memberships grant nothing', () => {
    let subject: any;
    let subjectMembership: any;

    beforeEach(async () => {
      subject = await prisma.user.create({
        data: {
          email: `inactive-subject-${Date.now()}@test.com`,
          password_hash: await bcrypt.hash(PASSWORD, SALT),
          first_name: 'Subject',
        },
      });
      subjectMembership = await prisma.companyMembership.create({
        data: {
          user_id: subject.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      await prisma.userBranchRole.create({
        data: { user_id: subject.id, branch_id: branchA.id, role_id: adminRoleA.id },
      });
    });

    afterEach(async () => {
      await deleteUserCascade(prisma, subject.id);
    });

    const deactivate = () =>
      prisma.companyMembership.update({
        where: { id: subjectMembership.id },
        data: { status: MembershipStatus.INACTIVE },
      });

    it('M3-a. getUser returns 404 for an INACTIVE member', async () => {
      const before = await request(app.getHttpServer())
        .get(`/api/v1/users/${subject.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect(before.status).toBe(200);

      await deactivate();

      const after = await request(app.getHttpServer())
        .get(`/api/v1/users/${subject.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect(after.status).toBe(404);
    });

    it('M3-b. updateUser returns 404 for an INACTIVE member', async () => {
      await deactivate();

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${subject.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ first_name: 'ShouldNotApply' });
      expect(res.status).toBe(404);

      const unchanged = await prisma.user.findUnique({ where: { id: subject.id } });
      expect(unchanged!.first_name).toBe('Subject');
    });

    it('M4-a. branch-filtered listUsers excludes INACTIVE members', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ branch_id: branchA.id })
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect(before.body.map((u: any) => u.id)).toContain(subject.id);

      await deactivate();

      const after = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ branch_id: branchA.id })
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect(after.status).toBe(200);
      // The stale UserBranchRole row still exists, but the user is no longer staff.
      expect(after.body.map((u: any) => u.id)).not.toContain(subject.id);
    });

    it('M4-b. unfiltered listUsers also excludes INACTIVE members', async () => {
      await deactivate();

      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);
      expect(res.body.map((u: any) => u.id)).not.toContain(subject.id);
    });

    it('M3-c. an INACTIVE member cannot act, even holding branch roles', async () => {
      const token = (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: subject.email, password: PASSWORD })
      ).body.accessToken;

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/branches')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(200);

      await deactivate();

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/branches')
            .set('Authorization', `Bearer ${token}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(403);
    });

    it('M3-d. an INACTIVE member cannot be given a branch role', async () => {
      await deactivate();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/users/${subject.id}/branch-roles`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id)
        .send({ branch_id: branchA.id, role_id: adminRoleA.id });
      expect(res.status).toBe(422);
    });

    it('M3-e. reactivating the membership restores access', async () => {
      await deactivate();
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/users/${subject.id}`)
            .set('Authorization', `Bearer ${adminTokenA}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(404);

      await prisma.companyMembership.update({
        where: { id: subjectMembership.id },
        data: { status: MembershipStatus.ACTIVE },
      });

      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/users/${subject.id}`)
            .set('Authorization', `Bearer ${adminTokenA}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // L5 — USER CREATION SCOPE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('L5 — users.create is company-scoped', () => {
    it('L5-a. a created user gets an ACTIVE membership in the acting company', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'scoped-create@test.com', password: 'Password123!' });

      expect(res.status).toBe(201);

      const membership = await prisma.companyMembership.findUnique({
        where: {
          user_id_company_id: { user_id: res.body.id, company_id: companyA.id },
        },
      });
      expect(membership).not.toBeNull();
      expect(membership!.status).toBe(MembershipStatus.ACTIVE);

      await deleteUserCascade(prisma, res.body.id);
    });

    it('L5-b. the created user is immediately visible in the company user list', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'scoped-visible@test.com', password: 'Password123!' });
      expect(created.status).toBe(201);

      const list = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      // Previously the account existed globally but belonged to nobody — it
      // appeared in no company's list and could not be managed anywhere.
      expect(list.body.map((u: any) => u.id)).toContain(created.body.id);

      await deleteUserCascade(prisma, created.body.id);
    });

    it('L5-c. the user is NOT made a member of any other company', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'scoped-isolated@test.com', password: 'Password123!' });
      expect(created.status).toBe(201);

      const memberships = await prisma.companyMembership.findMany({
        where: { user_id: created.body.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].company_id).toBe(companyA.id);

      const otherList = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenB}`)
        .set('X-Company-ID', companyB.id);
      expect(otherList.body.map((u: any) => u.id)).not.toContain(created.body.id);

      await deleteUserCascade(prisma, created.body.id);
    });

    it('L5-d. a duplicate email is still rejected without side effects', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ email: 'status-member@test.com', password: 'Password123!' });

      expect(res.status).toBe(409);

      const memberships = await prisma.companyMembership.findMany({
        where: { user_id: memberUser.id },
      });
      expect(memberships).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // L1 — MALFORMED UUID PATH PARAMS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('L1 — malformed UUID path params return 400, never 500', () => {
    const BAD = 'not-a-uuid';

    const cases: Array<[string, () => request.Test]> = [
      ['GET /users/:id', () =>
        request(app.getHttpServer())
          .get(`/api/v1/users/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)],
      ['PATCH /users/:id', () =>
        request(app.getHttpServer())
          .patch(`/api/v1/users/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .send({ first_name: 'X' })],
      ['POST /users/:id/branch-roles', () =>
        request(app.getHttpServer())
          .post(`/api/v1/users/${BAD}/branch-roles`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .set('X-Branch-ID', branchA.id)
          .send({ branch_id: branchA.id, role_id: adminRoleA.id })],
      ['DELETE /users/:id/branch-roles/:assignmentId', () =>
        request(app.getHttpServer())
          .delete(`/api/v1/users/${adminA.id}/branch-roles/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .set('X-Branch-ID', branchA.id)],
      ['GET /roles/:id', () =>
        request(app.getHttpServer())
          .get(`/api/v1/roles/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)],
      ['PATCH /roles/:id', () =>
        request(app.getHttpServer())
          .patch(`/api/v1/roles/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .send({ name: 'X' })],
      ['PUT /roles/:id/permissions', () =>
        request(app.getHttpServer())
          .put(`/api/v1/roles/${BAD}/permissions`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)
          .send({ permissions: [] })],
      ['GET /companies/:id', () =>
        request(app.getHttpServer())
          .get(`/api/v1/companies/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)],
      ['GET /branches/:id', () =>
        request(app.getHttpServer())
          .get(`/api/v1/branches/${BAD}`)
          .set('Authorization', `Bearer ${adminTokenA}`)
          .set('X-Company-ID', companyA.id)],
    ];

    it.each(cases)('L1 — %s returns 400', async (_label, run) => {
      const res = await run();
      expect(res.status).toBe(400);
    });

    it('L1-x. a malformed UUID never reaches the database as a 500', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${BAD}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id);

      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      // No raw Prisma detail leaks into the response
      expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY LIFECYCLE RECOVERY
  //
  // POLICY UNDER TEST (see CompaniesService.updateCompanyStatus):
  //
  //   Normal company operations against a disabled company  → DENIED
  //   Lifecycle transition by an authorized recovery actor   → ALLOWED
  //
  // The recovery route is the ONLY route that does not require the company to
  // be ACTIVE. It still requires an ACTIVE membership in that exact company
  // plus companies.disable, so cross-company recovery cannot be expressed.
  //
  //   ACTIVE   ↔ INACTIVE   permitted (symmetric — disabling is recoverable)
  //   *        → SUSPENDED  refused (platform-imposed state)
  //   SUSPENDED→ *          refused (customer cannot self-clear suspension)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Company lifecycle recovery', () => {
    const setStatus = (token: string, companyId: string, status: string) =>
      request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyId)
        .send({ status });

    const listBranches = (token: string, companyId: string) =>
      request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyId);

    afterEach(async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.ACTIVE);
    });

    it('REC-a. full lockout-and-recovery cycle', async () => {
      // 1. active company → normal operation succeeds
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(200);

      // 2. an authorized actor disables it
      const disabled = await setStatus(adminTokenA, companyA.id, 'INACTIVE');
      expect(disabled.status).toBe(200);
      expect(disabled.body.status).toBe('INACTIVE');

      // 3. normal operations are now denied — H4 still holds
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(403);

      // 4. ...but the SAME actor can still recover it. This is the whole point:
      //    the permission that disables also re-enables, so disabling can never
      //    be a one-way lockout.
      const recovered = await setStatus(adminTokenA, companyA.id, 'ACTIVE');
      expect(recovered.status).toBe(200);
      expect(recovered.body.status).toBe('ACTIVE');

      // 5. after reactivation → normal authorization works again
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(200);
    });

    it('REC-b. recovery works from INACTIVE even though normal ops are denied', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);

      // Ordinary company-scoped route: denied.
      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(403);
      // Ordinary company update: also denied.
      const update = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Renamed While Disabled' });
      expect(update.status).toBe(403);

      // Only the lifecycle route is reachable.
      expect((await setStatus(adminTokenA, companyA.id, 'ACTIVE')).status).toBe(200);
    });

    it('REC-c. an authenticated member WITHOUT companies.disable cannot recover', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);

      // restrictedUser is an ACTIVE member of companyA but lacks the permission.
      const res = await setStatus(restrictedToken, companyA.id, 'ACTIVE');
      expect(res.status).toBe(403);

      const unchanged = await prisma.company.findUnique({ where: { id: companyA.id } });
      expect(unchanged!.status).toBe(CompanyStatus.INACTIVE);
    });

    it('REC-d. cross-company recovery is impossible', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);

      // adminB holds companies.disable — but in companyB, not companyA.
      const res = await setStatus(adminTokenB, companyA.id, 'ACTIVE');
      expect(res.status).toBe(403);

      const unchanged = await prisma.company.findUnique({ where: { id: companyA.id } });
      expect(unchanged!.status).toBe(CompanyStatus.INACTIVE);
    });

    it('REC-e. an unauthenticated request cannot recover', async () => {
      await setCompanyStatus(companyA.id, CompanyStatus.INACTIVE);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/status`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(401);
    });

    it('REC-f. a mismatched X-Company-ID is rejected, header is not proof', async () => {
      // URL says companyB, header says companyA. The guard authorizes against
      // the header; the controller refuses the mismatch outright.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyB.id}/status`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(403);

      const untouched = await prisma.company.findUnique({ where: { id: companyB.id } });
      expect(untouched!.status).toBe(CompanyStatus.ACTIVE);
    });

    it('REC-g. SUSPENDED cannot be set through the company API', async () => {
      const res = await setStatus(adminTokenA, companyA.id, 'SUSPENDED');
      expect(res.status).toBe(403);

      const unchanged = await prisma.company.findUnique({ where: { id: companyA.id } });
      expect(unchanged!.status).toBe(CompanyStatus.ACTIVE);
    });

    it('REC-h. a SUSPENDED company cannot be self-reactivated', async () => {
      // Suspension is platform-imposed (billing/abuse). If a customer admin
      // could clear it, suspension would be meaningless.
      await setCompanyStatus(companyA.id, CompanyStatus.SUSPENDED);

      expect((await listBranches(adminTokenA, companyA.id)).status).toBe(403);

      const res = await setStatus(adminTokenA, companyA.id, 'ACTIVE');
      expect(res.status).toBe(403);

      const stillSuspended = await prisma.company.findUnique({
        where: { id: companyA.id },
      });
      expect(stillSuspended!.status).toBe(CompanyStatus.SUSPENDED);
    });

    it('REC-i. status is NOT settable through the general company update route', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });

      // forbidNonWhitelisted rejects it — there is exactly one path to status.
      expect(res.status).toBe(400);

      const unchanged = await prisma.company.findUnique({ where: { id: companyA.id } });
      expect(unchanged!.status).toBe(CompanyStatus.ACTIVE);
    });

    it('REC-j. the transition is audited with both old and new status', async () => {
      await setStatus(adminTokenA, companyA.id, 'INACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'COMPANY_STATUS', entity_id: companyA.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect((audit!.payload as any).from).toBe('ACTIVE');
      expect((audit!.payload as any).to).toBe('INACTIVE');
    });

    it('REC-k. an unknown company id does not leak existence', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/companies/00000000-0000-4000-8000-000000000000/status')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', '00000000-0000-4000-8000-000000000000')
        .send({ status: 'ACTIVE' });
      // No membership in a company that does not exist → guard denies first.
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL USER DISABLE
  //
  // GLOBAL USER DISABLE  ≠  COMPANY MEMBERSHIP INACTIVATION
  //
  //   UserStatus.INACTIVE        → cannot sign in anywhere on the platform
  //   MembershipStatus.INACTIVE  → not part of ONE company; account still valid
  //
  // A company-scoped permission (users.disable) may trigger the global action
  // ONLY for users who belong to no other company. See UsersService.setUserStatus.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Global user disable', () => {
    let employee: any;
    let employeeToken: string;
    let employeeRefresh: string;

    const setStatus = (token: string, userId: string, status: string, companyId: string) =>
      request(app.getHttpServer())
        .patch(`/api/v1/users/${userId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Company-ID', companyId)
        .send({ status });

    beforeEach(async () => {
      employee = await prisma.user.create({
        data: {
          email: `employee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
          password_hash: await bcrypt.hash(PASSWORD, SALT),
        },
      });
      await prisma.companyMembership.create({
        data: {
          user_id: employee.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      await prisma.userBranchRole.create({
        data: {
          user_id: employee.id,
          branch_id: branchA.id,
          role_id: restrictedRoleA.id,
        },
      });

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: PASSWORD });
      employeeToken = login.body.accessToken;
      employeeRefresh = login.body.refreshToken;
    });

    afterEach(async () => {
      await deleteUserCascade(prisma, employee.id);
    });

    it('USR-a. an ACTIVE user can authenticate and operate', async () => {
      expect(employeeToken).toBeDefined();

      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Company-ID', companyA.id);
      expect(res.status).toBe(200);
    });

    it('USR-b. a disabled user cannot log in, indistinguishably from a wrong password', async () => {
      // Baseline: the correct password on a still-ACTIVE account is rejected
      // only because the password is wrong.
      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: 'DefinitelyWrong123!' });
      expect(wrongPassword.status).toBe(401);

      expect((await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id)).status).toBe(200);

      // Now the CORRECT password on a disabled account.
      const disabled = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: PASSWORD });

      expect(disabled.status).toBe(401);
      expect(disabled.body.message).toBe('Invalid credentials');

      // The two responses must be indistinguishable, otherwise the disabled
      // state confirms the address is registered. Compared field-by-field
      // rather than by substring, so the standard statusCode/path envelope
      // does not produce a false positive.
      expect(disabled.status).toBe(wrongPassword.status);
      expect(disabled.body.message).toBe(wrongPassword.body.message);
      expect(Object.keys(disabled.body).sort()).toEqual(
        Object.keys(wrongPassword.body).sort(),
      );
      expect(disabled.body.message).not.toMatch(/disabl|inactive|suspend/i);
    });

    it('USR-c. an existing access token stops working immediately', async () => {
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${employeeToken}`)
        ).status,
      ).toBe(200);

      await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);

      // Same unexpired token, now rejected.
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${employeeToken}`)
        ).status,
      ).toBe(401);

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/branches')
            .set('Authorization', `Bearer ${employeeToken}`)
            .set('X-Company-ID', companyA.id)
        ).status,
      ).toBe(401);
    });

    it('USR-d. an existing refresh session can no longer refresh', async () => {
      await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: employeeRefresh });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid refresh token');
    });

    // USR-c and USR-d above pass partly because setUserStatus ALSO revokes the
    // target's sessions. These two isolate the status checks themselves by
    // disabling the account directly in the database, leaving the session live —
    // which is also the real-world case of an out-of-band/ops disable.

    it('USR-c2. a live session is rejected when the account is disabled out-of-band', async () => {
      // Deliberately NOT /auth/me: that route has its own status check in
      // getProfile, so it would pass even if JwtStrategy did nothing. A
      // company-scoped route is guarded only by JwtStrategy + PermissionGuard,
      // which isolates the token-level status check.
      const branches = () =>
        request(app.getHttpServer())
          .get('/api/v1/branches')
          .set('Authorization', `Bearer ${employeeToken}`)
          .set('X-Company-ID', companyA.id);

      expect((await branches()).status).toBe(200);

      // Directly disable — no session revocation side effect.
      await prisma.user.update({
        where: { id: employee.id },
        data: { status: 'INACTIVE' },
      });
      const stillLive = await prisma.userSession.count({
        where: { user_id: employee.id, revoked_at: null },
      });
      expect(stillLive).toBeGreaterThan(0);

      // 401 (authentication), not 403 — JwtStrategy must reject the token on
      // account status alone, before authorization is even considered.
      expect((await branches()).status).toBe(401);

      // /auth/me is rejected too, by its own defence-in-depth check.
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${employeeToken}`)
        ).status,
      ).toBe(401);
    });

    it('USR-d2. an out-of-band disabled account cannot refresh, and the session is revoked', async () => {
      await prisma.user.update({
        where: { id: employee.id },
        data: { status: 'INACTIVE' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: employeeRefresh });
      expect(res.status).toBe(401);

      // Refusing is not enough — the session is killed so it cannot be retried
      // if the account is later re-enabled with the same token in hand.
      const sessionId = employeeRefresh.split('.')[0];
      const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
      expect(session!.revoked_at).not.toBeNull();
    });

    it('USR-e. re-enabling restores authentication', async () => {
      await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: employee.email, password: PASSWORD })
        ).status,
      ).toBe(401);

      const restored = await setStatus(adminTokenA, employee.id, 'ACTIVE', companyA.id);
      expect(restored.status).toBe(200);
      expect(restored.body.status).toBe('ACTIVE');

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.accessToken).toBeDefined();
    });

    it('USR-f. membership deactivation does NOT globally disable the account', async () => {
      // This is the concept boundary: removing someone from a company must not
      // terminate their platform identity.
      const membership = await prisma.companyMembership.findUnique({
        where: {
          user_id_company_id: { user_id: employee.id, company_id: companyA.id },
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}/members/${membership!.id}`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: MembershipStatus.INACTIVE });
      expect(res.status).toBe(200);

      // Global status untouched...
      const stillActive = await prisma.user.findUnique({ where: { id: employee.id } });
      expect(stillActive!.status).toBe('ACTIVE');

      // ...so the user can still authenticate...
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: PASSWORD });
      expect(login.status).toBe(200);

      // ...but has no access to that company any more.
      const denied = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .set('X-Company-ID', companyA.id);
      expect(denied.status).toBe(403);
    });

    it('USR-g. a member without users.disable cannot disable anyone', async () => {
      const res = await setStatus(restrictedToken, employee.id, 'INACTIVE', companyA.id);
      expect(res.status).toBe(403);

      const unchanged = await prisma.user.findUnique({ where: { id: employee.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });

    it('USR-h. cross-company disable is rejected', async () => {
      // adminB holds users.disable, but in companyB. The employee is in companyA.
      const res = await setStatus(adminTokenB, employee.id, 'INACTIVE', companyB.id);
      // 404: the target is not a member of companyB, and we do not disclose that
      // the account exists elsewhere.
      expect(res.status).toBe(404);

      const unchanged = await prisma.user.findUnique({ where: { id: employee.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });

    it('USR-i. a multi-company user cannot be globally disabled by one company', async () => {
      // The critical containment rule: a companyA admin must not be able to
      // revoke a user's access to companyB.
      await prisma.companyMembership.create({
        data: {
          user_id: employee.id,
          company_id: companyB.id,
          status: MembershipStatus.ACTIVE,
        },
      });

      const res = await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);
      expect(res.status).toBe(422);

      const unchanged = await prisma.user.findUnique({ where: { id: employee.id } });
      expect(unchanged!.status).toBe('ACTIVE');

      // The account still works, including in the other company.
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: employee.email, password: PASSWORD });
      expect(login.status).toBe(200);
    });

    it('USR-j. an actor cannot disable their own account', async () => {
      const membership = await prisma.companyMembership.findFirst({
        where: { user_id: adminA.id, company_id: companyA.id },
      });
      expect(membership).not.toBeNull();

      const res = await setStatus(adminTokenA, adminA.id, 'INACTIVE', companyA.id);
      expect(res.status).toBe(403);

      const unchanged = await prisma.user.findUnique({ where: { id: adminA.id } });
      expect(unchanged!.status).toBe('ACTIVE');
    });

    it('USR-k. a platform superadmin cannot be disabled by a company admin', async () => {
      // A RESTRICTION, not a grant: is_superadmin still authorizes nothing.
      const superadmin = await prisma.user.create({
        data: {
          email: `super-${Date.now()}@test.com`,
          password_hash: await bcrypt.hash(PASSWORD, SALT),
          is_superadmin: true,
        },
      });
      await prisma.companyMembership.create({
        data: {
          user_id: superadmin.id,
          company_id: companyA.id,
          status: MembershipStatus.ACTIVE,
        },
      });

      const res = await setStatus(adminTokenA, superadmin.id, 'INACTIVE', companyA.id);
      expect(res.status).toBe(403);

      const unchanged = await prisma.user.findUnique({ where: { id: superadmin.id } });
      expect(unchanged!.status).toBe('ACTIVE');

      await deleteUserCascade(prisma, superadmin.id);
    });

    it('USR-l. the status change is audited with old and new values', async () => {
      await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'USER_STATUS', entity_id: employee.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.event_type).toBe('SECURITY');
      expect((audit!.payload as any).from).toBe('ACTIVE');
      expect((audit!.payload as any).to).toBe('INACTIVE');
      expect(audit!.company_id).toBe(companyA.id);
    });

    it('USR-m. disabling revokes the user\'s live sessions', async () => {
      const sessionsBefore = await prisma.userSession.count({
        where: { user_id: employee.id, revoked_at: null },
      });
      expect(sessionsBefore).toBeGreaterThan(0);

      await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);

      const stillLive = await prisma.userSession.count({
        where: { user_id: employee.id, revoked_at: null },
      });
      expect(stillLive).toBe(0);
    });

    it('USR-n. no credential material appears in the status response', async () => {
      const res = await setStatus(adminTokenA, employee.id, 'INACTIVE', companyA.id);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('password_hash');
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    });

    it('USR-o. a malformed target id is a controlled 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/not-a-uuid/status')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: 'INACTIVE' });
      expect(res.status).toBe(400);
    });

    it('USR-p. an invalid status value is rejected', async () => {
      const res = await setStatus(adminTokenA, employee.id, 'BANNED', companyA.id);
      expect(res.status).toBe(400);
    });
  });
});

/**
 * The owner account (central control) and "Forgot password" by emailed code.
 *
 * Fixture:
 *   alpha ─ HQ, Two   ─ admin (every permission, a shared role) ; staff
 *   beta  ─ Beta HQ
 *   owner ─ made owner by syncOwnerAccess, as the set-up script does
 * Email goes to a stub that records each message instead of sending it.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { MailService, type MailMessage } from '../src/common/mail/mail.service.js';
import { syncOwnerAccess } from '../src/modules/users/owner-access.js';
import { RECOVERY_SENT_MESSAGE } from '../src/modules/auth/password-recovery.service.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { BranchStatus, CompanyStatus, MembershipStatus } from '@samco/database';

const PASSWORD = 'SecurePassword123!';
const OWNER_EMAIL = 'owner@samco-test.com';

describe('Owner account and password recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;
  const sent: MailMessage[] = [];
  const mail = { configured: true, failNext: false, async send(m: MailMessage) {
    if (mail.failNext) {
      mail.failNext = false;
      throw new Error('SMTP down');
    }
    sent.push(m);
  } };

  let alpha: any, beta: any, hq: any, two: any;
  let owner: any, admin: any, staff: any;
  let ownerToken: string, adminToken: string;

  const login = (email: string, password = PASSWORD) => request(http).post('/api/v1/auth/login').send({ email, password });
  const as = (req: request.Test, token: string, companyId = alpha.id, branchId?: string) => {
    const r = req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    return branchId ? r.set('X-Branch-ID', branchId) : r;
  };
  const codeFrom = (m: MailMessage) => /\b(\d{6})\b/.exec(m.text)![1];
  const ask = (email: string) => request(http).post('/api/v1/auth/password-recovery/request').send({ email });
  const reset = (email: string, code: string, new_password = 'NewOwner#2026') =>
    request(http).post('/api/v1/auth/password-recovery/reset').send({ email, code, new_password });
  // Lets the next code be asked for without waiting out the 60-second cooldown.
  const ageCodes = () =>
    prisma.passwordResetCode.updateMany({ where: { user_id: owner.id }, data: { created_at: new Date(Date.now() - 120_000) } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
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

    alpha = await prisma.company.create({ data: { name: 'Owner Alpha', status: CompanyStatus.ACTIVE } });
    beta = await prisma.company.create({ data: { name: 'Owner Beta', status: CompanyStatus.ACTIVE } });
    const branch = (company_id: string, name: string) =>
      prisma.branch.create({ data: { company_id, name, timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    hq = await branch(alpha.id, 'HQ');
    two = await branch(alpha.id, 'Two');
    await branch(beta.id, 'Beta HQ');

    owner = await prisma.user.create({ data: { email: OWNER_EMAIL, password_hash: hash, is_owner: true, is_superadmin: true } });
    admin = await prisma.user.create({ data: { email: 'ow-admin@test.com', password_hash: hash } });
    staff = await prisma.user.create({ data: { email: 'ow-staff@test.com', password_hash: hash } });
    await prisma.companyMembership.createMany({
      data: [admin, staff].map((u) => ({ user_id: u.id, company_id: alpha.id, status: MembershipStatus.ACTIVE })),
    });
    const everything = await prisma.role.create({ data: { company_id: alpha.id, name: 'Everything' } });
    const perms = await prisma.permission.findMany();
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: everything.id, permission_id: p.id })) });
    await prisma.userBranchRole.createMany({
      data: [hq, two].map((b) => ({ user_id: admin.id, branch_id: b.id, role_id: everything.id })),
    });

    await prisma.$transaction((tx) => syncOwnerAccess(tx, owner.id));
    ownerToken = (await login(OWNER_EMAIL)).body.accessToken;
    adminToken = (await login('ow-admin@test.com')).body.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  describe('the owner', () => {
    it('OW-1. is an Admin with every permission at every branch of every company', async () => {
      const memberships = await prisma.companyMembership.findMany({ where: { user_id: owner.id } });
      expect(memberships.map((m) => [m.status, m.user_type, m.is_corporate])).toEqual([
        ['ACTIVE', 'ADMIN', true],
        ['ACTIVE', 'ADMIN', true],
      ]);
      expect(await prisma.userBranchRole.count({ where: { user_id: owner.id } })).toBe(3);
      const role = await prisma.role.findFirst({
        where: { company_id: alpha.id, personal_user_id: owner.id },
        include: { _count: { select: { permissions: true } } },
      });
      expect(role!._count.permissions).toBe(await prisma.permission.count());

      // Shows as the owner on User Management.
      const list = await as(request(http).get('/api/v1/user-access/users'), ownerToken);
      expect(list.body.find((u: any) => u.email === OWNER_EMAIL)).toMatchObject({ owner: true, user_type: 'ADMIN', corporate: true });
    });

    it('OW-2. can add users and give them any access', async () => {
      const res = await as(request(http).post('/api/v1/user-access/users'), ownerToken).send({
        email: 'ow-new-admin@test.com',
        password: 'Password1234',
        user_type: 'ADMIN',
        corporate: true,
        access: { toggles: ['queue.podium', 'banquet.discount'], routines: { 'eod-report': 'MANAGER' }, tasks: 'BOTH' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ user_type: 'ADMIN', corporate: true, owner: false });
    });

    it('OW-3. nobody else can change, disable or remove the owner', async () => {
      const save = await as(request(http).put(`/api/v1/user-access/users/${owner.id}`), adminToken).send({
        user_type: 'STAFF',
        corporate: false,
        branch_id: hq.id,
        access: { toggles: [], routines: {}, tasks: 'OFF' },
      });
      expect(save.status).toBe(403);
      expect(save.body.message).toMatch(/owner account cannot be changed/);

      expect((await as(request(http).patch(`/api/v1/users/${owner.id}/status`), adminToken).send({ status: 'INACTIVE' })).status).toBe(403);
      const membership = await prisma.companyMembership.findFirst({ where: { user_id: owner.id, company_id: alpha.id } });
      expect(
        (await as(request(http).patch(`/api/v1/companies/${alpha.id}/members/${membership!.id}`), adminToken).send({ status: 'INACTIVE' }))
          .status,
      ).toBe(403);
      const assignment = await prisma.userBranchRole.findFirst({ where: { user_id: owner.id, branch_id: hq.id } });
      expect(
        (await as(request(http).delete(`/api/v1/users/${owner.id}/branch-roles/${assignment!.id}`), adminToken, alpha.id, hq.id)).status,
      ).toBe(403);
      // Still intact.
      expect(await prisma.userBranchRole.count({ where: { user_id: owner.id } })).toBe(3);
    });

    it('OW-4. new companies and new branches include the owner', async () => {
      const company = await request(http).post('/api/v1/companies').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Owner Gamma' });
      expect(company.status).toBe(201);
      const membership = await prisma.companyMembership.findUnique({
        where: { user_id_company_id: { user_id: owner.id, company_id: company.body.id } },
      });
      expect(membership).toMatchObject({ status: 'ACTIVE', user_type: 'ADMIN', is_corporate: true });

      const branch = await as(request(http).post('/api/v1/branches'), ownerToken, company.body.id).send({ name: 'Gamma HQ', timezone: 'Asia/Kolkata' });
      expect(branch.status).toBe(201);
      expect(await prisma.userBranchRole.count({ where: { user_id: owner.id, branch_id: branch.body.id } })).toBe(1);
    });
  });

  describe('forgot password', () => {
    it('PR-1. other accounts get the same reply and nothing is sent', async () => {
      for (const email of ['ow-staff@test.com', 'ow-admin@test.com', 'nobody@test.com']) {
        const res = await ask(email);
        expect(res.status).toBe(202);
        expect(res.body.message).toBe(RECOVERY_SENT_MESSAGE);
      }
      expect(sent).toHaveLength(0);
      expect(await prisma.passwordResetCode.count()).toBe(0);
      // And no code works for them.
      expect((await reset('ow-staff@test.com', '123456')).status).toBe(400);
    });

    it('PR-2. the owner gets a code by email, resets with it, and is signed out everywhere', async () => {
      const oldRefresh = (await login(OWNER_EMAIL)).body.refreshToken;
      const res = await ask('Owner@Samco-Test.com');
      expect(res.status).toBe(202);
      expect(res.body.message).toBe(RECOVERY_SENT_MESSAGE);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(OWNER_EMAIL);
      const code = codeFrom(sent[0]);
      // Only a hash is stored.
      const row = await prisma.passwordResetCode.findFirst({ where: { user_id: owner.id } });
      expect(row!.code_hash).not.toContain(code);

      const wrong = code === '000000' ? '111111' : '000000';
      expect((await reset(OWNER_EMAIL, wrong)).status).toBe(400);
      expect((await reset(OWNER_EMAIL, code, 'short')).status).toBe(400);
      const ok = await reset(OWNER_EMAIL, code);
      expect(ok.status).toBe(200);

      expect((await login(OWNER_EMAIL)).status).toBe(401);
      expect((await login(OWNER_EMAIL, 'NewOwner#2026')).status).toBe(200);
      expect((await request(http).post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh })).status).toBe(401);
      // A code works once.
      expect((await reset(OWNER_EMAIL, code, 'Another#2026')).status).toBe(400);
      const audit = await prisma.auditLog.findMany({ where: { entity_id: owner.id, event_type: 'SECURITY' } });
      expect(audit.map((a: any) => a.payload.action)).toEqual(
        expect.arrayContaining(['password_reset_requested', 'password_reset_failure', 'password_reset']),
      );
    });

    it('PR-3. a minute between codes; five wrong tries spend a code; a newer code replaces the old', async () => {
      await ageCodes();
      expect((await ask(OWNER_EMAIL)).status).toBe(202);
      expect((await ask(OWNER_EMAIL)).status).toBe(429);
      const first = codeFrom(sent[sent.length - 1]);

      await ageCodes();
      expect((await ask(OWNER_EMAIL)).status).toBe(202);
      const second = codeFrom(sent[sent.length - 1]);
      if (first !== second) expect((await reset(OWNER_EMAIL, first)).status).toBe(400);

      const wrong = second === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) expect((await reset(OWNER_EMAIL, wrong)).status).toBe(400);
      // Spent: even the right code no longer works.
      expect((await reset(OWNER_EMAIL, second)).status).toBe(400);
    });

    it('PR-4. says so when email is not set up or the email cannot be sent', async () => {
      mail.configured = false;
      expect((await ask(OWNER_EMAIL)).status).toBe(503);
      expect((await ask('nobody@test.com')).status).toBe(503);
      mail.configured = true;

      await ageCodes();
      mail.failNext = true;
      expect((await ask(OWNER_EMAIL)).status).toBe(502);
      // The unsent code is not left usable.
      expect(await prisma.passwordResetCode.count({ where: { user_id: owner.id, consumed_at: null } })).toBe(0);
    });
  });
});

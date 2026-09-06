import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import {
  resetDatabase,
  assertPermissionsSeeded,
} from './utils/db.js';
import * as bcrypt from 'bcrypt';
import { CompanyStatus, AuditEventType } from '@samco/database';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

const PASSWORD = 'TestPassword123!';
const SALT = 10;

describe('AuditLogsModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminUser: any;
  let normalUser: any;
  let companyA: any;
  let companyB: any;
  let branchA: any;

  let adminToken: string;
  let normalToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Registered to match production error rendering (and the other suites) —
    // without it this spec exercised a different error path than the real app.
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

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const pwdHash = await bcrypt.hash(PASSWORD, SALT);

    adminUser = await prisma.user.create({
      data: { email: 'auditadmin@alpha.com', password_hash: pwdHash },
    });
    normalUser = await prisma.user.create({
      data: { email: 'auditnormal@alpha.com', password_hash: pwdHash },
    });

    const loginAndGetToken = async (email: string) => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email,
        password: PASSWORD,
      });
      return res.body.accessToken;
    };

    adminToken = await loginAndGetToken(adminUser.email);
    normalToken = await loginAndGetToken(normalUser.email);

    // Create companies via the API so real audit records are produced.
    const resA = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Alpha Audit Corp' });
    companyA = resA.body;

    const resB = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${normalToken}`)
      .send({ name: 'Beta Audit Corp' });
    companyB = resB.body;

    // Permissions come from the seeded system catalogue — this spec no longer
    // invents Permission rows, which previously leaked test-only records
    // (module: 'Test') into the shared catalogue with no cleanup.
    const adminPerms = await prisma.permission.findMany({
      where: {
        name: { in: ['companies.update', 'branches.create', 'audit_logs.view'] },
      },
    });

    const adminRole = await prisma.role.create({
      data: { company_id: companyA.id, name: 'AdminRole' },
    });
    await prisma.rolePermission.createMany({
      data: adminPerms.map((p) => ({ role_id: adminRole.id, permission_id: p.id })),
    });

    branchA = await prisma.branch.create({
      data: { company_id: companyA.id, name: 'Default', timezone: 'UTC' },
    });
    await prisma.userBranchRole.create({
      data: { user_id: adminUser.id, branch_id: branchA.id, role_id: adminRole.id },
    });

    // normalUser gets a role in companyB only — used for cross-company isolation.
    const betaBranch = await prisma.branch.create({
      data: { company_id: companyB.id, name: 'Beta HQ', timezone: 'America/New_York' },
    });
    const betaRole = await prisma.role.create({
      data: { company_id: companyB.id, name: 'Beta Manager' },
    });
    const betaPerms = await prisma.permission.findMany({
      where: { name: { in: ['branches.view', 'companies.view', 'audit_logs.view'] } },
    });
    await prisma.rolePermission.createMany({
      data: betaPerms.map((p) => ({ role_id: betaRole.id, permission_id: p.id })),
    });
    await prisma.userBranchRole.create({
      data: { user_id: normalUser.id, branch_id: betaBranch.id, role_id: betaRole.id },
    });
  });

  afterAll(async () => {
    // This suite previously had no afterAll at all, leaving companies, users,
    // branches, roles and audit rows behind for whichever suite ran next.
    await resetDatabase(prisma);
    await app.close();
  });

  describe('Security Events', () => {
    it('1. successful login creates security audit', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email: adminUser.email,
        password: PASSWORD,
      });

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'SECURITY', entity_type: 'AUTHENTICATION', user_id: adminUser.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).toBeDefined();
      expect((audit!.payload as any).method).toBe('password');
      expect((audit!.payload as any).action).toBe('login_success');
    });

    it('2. failed login creates security audit with null company', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email: 'nobody@nowhere.com',
        password: 'wrong',
      });

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'SECURITY', entity_type: 'AUTHENTICATION', user_id: null },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).toBeDefined();
      expect((audit!.payload as any).reason).toBe('invalid_credentials');
    });

    it('3. failed login with existing email creates audit', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email: adminUser.email,
        password: 'wrongpassword',
      });

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'SECURITY', entity_type: 'AUTHENTICATION', user_id: adminUser.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).toBeDefined();
      expect((audit!.payload as any).reason).toBe('invalid_credentials');
    });
  });

  describe('CRUD Mutations trigger Audits', () => {
    it('4. company update creates audit', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Alpha Audit Corp (renamed)' });

      expect(res.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'UPDATE', entity_type: 'COMPANY', company_id: companyA.id },
      });
      expect(audit).toBeDefined();
      expect((audit!.payload as any).changed_fields).toContain('name');

      // Company STATUS is no longer settable through PATCH /companies/:id — it
      // has its own route and permission so that disabling stays recoverable.
      // See the company-status suite in companies.e2e-spec.ts.
      const rejected = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ status: CompanyStatus.INACTIVE });
      expect(rejected.status).toBe(400);
    });

    it('5. branch creation creates audit', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'HQ', timezone: 'America/New_York' });

      expect(res.status).toBe(201);

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'CREATE', entity_type: 'BRANCH', company_id: companyA.id },
        orderBy: { created_at: 'desc' },
      });
      expect(audit).toBeDefined();
      expect(audit!.branch_id).toBe(res.body.id);
    });
  });

  describe('Read API & Isolation', () => {
    it('6. unauthenticated user receives 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('X-Company-ID', companyA.id)
        .expect(401);
    });

    it('7. unauthorized user receives 403', async () => {
      // normalUser has no membership in companyA at all.
      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${normalToken}`)
        .set('X-Company-ID', companyA.id)
        .expect(403);
    });

    it('8. authorized company user can read audit logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      res.body.data.forEach((log: any) => {
        const payloadStr = JSON.stringify(log.payload);
        expect(payloadStr).not.toContain(PASSWORD);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // H1 — DATABASE-LEVEL APPEND-ONLY IMMUTABILITY
  //
  // Route absence is not a control. These assert the database itself rejects
  // mutation of audit history, through the very client the application uses.
  // ═════════════════════════════════════════════════════════════════════════

  describe('H1 — audit immutability at the database', () => {
    it('H1-a. audit records can still be INSERTed through the legitimate path', async () => {
      const before = await prisma.auditLog.count({ where: { company_id: companyA.id } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .send({ name: 'Immutability Probe', timezone: 'UTC' });
      expect(res.status).toBe(201);

      const after = await prisma.auditLog.count({ where: { company_id: companyA.id } });
      expect(after).toBeGreaterThan(before);
    });

    it('H1-b. UPDATE on an audit record is rejected by the database', async () => {
      const log = await prisma.auditLog.findFirst({ where: { company_id: companyA.id } });
      expect(log).not.toBeNull();

      await expect(
        prisma.auditLog.update({
          where: { id: log!.id },
          data: { entity_type: 'TAMPERED' },
        }),
      ).rejects.toThrow(/append-only/i);

      // Content is genuinely unchanged
      const reread = await prisma.auditLog.findUnique({ where: { id: log!.id } });
      expect(reread!.entity_type).toBe(log!.entity_type);
    });

    it('H1-c. DELETE on an audit record is rejected by the database', async () => {
      const log = await prisma.auditLog.findFirst({ where: { company_id: companyA.id } });
      expect(log).not.toBeNull();

      await expect(
        prisma.auditLog.delete({ where: { id: log!.id } }),
      ).rejects.toThrow(/append-only/i);

      const reread = await prisma.auditLog.findUnique({ where: { id: log!.id } });
      expect(reread).not.toBeNull();
    });

    it('H1-d. bulk deleteMany is rejected too', async () => {
      await expect(
        prisma.auditLog.deleteMany({ where: { company_id: companyA.id } }),
      ).rejects.toThrow(/append-only/i);

      const remaining = await prisma.auditLog.count({ where: { company_id: companyA.id } });
      expect(remaining).toBeGreaterThan(0);
    });

    it('9. no PATCH audit endpoint', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/audit-logs/fake-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .expect(404);
    });

    it('10. no DELETE audit endpoint', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/audit-logs/fake-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id)
        .expect(404);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // H2 — QUERY FILTERS ACTUALLY FILTER
  // ═════════════════════════════════════════════════════════════════════════

  describe('H2 — audit query filters', () => {
    const get = (query: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .query(query)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Company-ID', companyA.id);

    it('H2-a. company scope is always applied', async () => {
      const res = await get({ limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const ids = res.body.data.map((r: any) => r.id);
      const foreign = await prisma.auditLog.findMany({
        where: { company_id: companyB.id },
        select: { id: true },
      });
      for (const f of foreign) {
        expect(ids).not.toContain(f.id);
      }
    });

    it('H2-b. entity_type filter narrows results', async () => {
      const all = await get({ limit: 100 });
      const filtered = await get({ entity_type: 'BRANCH', limit: 100 });

      expect(filtered.status).toBe(200);
      expect(filtered.body.data.length).toBeGreaterThan(0);
      expect(filtered.body.meta.total).toBeLessThan(all.body.meta.total);
      filtered.body.data.forEach((r: any) => expect(r.entity_type).toBe('BRANCH'));
    });

    it('H2-c. a filter matching nothing returns zero rows', async () => {
      const res = await get({ entity_type: 'NO_SUCH_ENTITY_TYPE' });
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(0);
      expect(res.body.data).toHaveLength(0);
    });

    it('H2-d. event_type filter works', async () => {
      const res = await get({ event_type: AuditEventType.CREATE, limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((r: any) => expect(r.event_type).toBe('CREATE'));
    });

    it('H2-e. entity_id filter works', async () => {
      const branchLog = await prisma.auditLog.findFirst({
        where: { company_id: companyA.id, entity_type: 'BRANCH' },
      });
      const res = await get({ entity_id: branchLog!.entity_id, limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((r: any) => expect(r.entity_id).toBe(branchLog!.entity_id));
    });

    it('H2-f. branch_id filter works', async () => {
      const res = await get({ branch_id: branchA.id, limit: 100 });
      expect(res.status).toBe(200);
      const rowsWithBranch = res.body.data.filter((r: any) => r.branch !== null);
      rowsWithBranch.forEach((r: any) => expect(r.branch.id).toBe(branchA.id));
    });

    it('H2-g. user_id filter works', async () => {
      const res = await get({ user_id: adminUser.id, limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((r: any) => expect(r.user?.id).toBe(adminUser.id));
    });

    it('H2-h. date range filtering works', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const none = await get({ from: future, limit: 100 });
      expect(none.status).toBe(200);
      expect(none.body.meta.total).toBe(0);

      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const some = await get({ from: past, limit: 100 });
      expect(some.body.meta.total).toBeGreaterThan(0);
    });

    it('H2-i. pagination works and total is filter-aware', async () => {
      const page1 = await get({ limit: 2, offset: 0 });
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.limit).toBe(2);
      expect(page1.body.meta.offset).toBe(0);

      const page2 = await get({ limit: 2, offset: 2 });
      expect(page2.body.data.length).toBeGreaterThan(0);
      expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id);
      expect(page2.body.meta.total).toBe(page1.body.meta.total);
    });

    it('H2-j. an out-of-range limit is rejected', async () => {
      const res = await get({ limit: 5000 });
      expect(res.status).toBe(400);
    });

    it('H2-k. company_id cannot be injected as a query filter', async () => {
      // company scope comes from the authorized context only; forbidNonWhitelisted
      // rejects any attempt to supply it.
      const res = await get({ company_id: companyB.id });
      expect(res.status).toBe(400);
    });

    it('H2-l. filtering by another company\'s branch returns nothing, not their data', async () => {
      const betaBranch = await prisma.branch.findFirst({
        where: { company_id: companyB.id },
      });
      const res = await get({ branch_id: betaBranch!.id, limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(0);
    });

    it('H2-m. cross-company isolation holds from the other side too', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .query({ limit: 100 })
        .set('Authorization', `Bearer ${normalToken}`)
        .set('X-Company-ID', companyB.id);

      expect(res.status).toBe(200);
      const alphaLogs = await prisma.auditLog.findMany({
        where: { company_id: companyA.id },
        select: { id: true },
      });
      const ids = res.body.data.map((r: any) => r.id);
      for (const a of alphaLogs) expect(ids).not.toContain(a.id);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // L3 / L4 — PAYLOAD SANITIZATION
  // ═════════════════════════════════════════════════════════════════════════

  describe('L3/L4 — audit payload sanitization', () => {
    it('L3-a. nested sensitive keys are redacted and the caller object is not mutated', async () => {
      const auditService: any = app.get(
        (await import('../src/modules/audit-logs/audit-logs.service.js')).AuditLogService,
      );

      const callerPayload = {
        action: 'probe',
        password: 'super-secret',
        nested: {
          refresh_token: 'rt-value',
          deep: { authorization: 'Bearer abc', keep: 'visible' },
        },
        list: [{ api_key: 'k1' }, { safe: 'yes' }],
      };
      const snapshot = JSON.parse(JSON.stringify(callerPayload));

      await auditService.create({
        actorUserId: adminUser.id,
        companyId: companyA.id,
        eventType: AuditEventType.SECURITY,
        entityType: 'SANITIZATION_PROBE',
        entityId: adminUser.id,
        payload: callerPayload,
      });

      // Caller's object graph untouched (previously mutated in place)
      expect(callerPayload).toEqual(snapshot);

      const stored = await prisma.auditLog.findFirst({
        where: { entity_type: 'SANITIZATION_PROBE' },
        orderBy: { created_at: 'desc' },
      });
      const p = stored!.payload as any;

      expect(p.password).toBe('[REDACTED]');
      expect(p.nested.refresh_token).toBe('[REDACTED]');
      expect(p.nested.deep.authorization).toBe('[REDACTED]');
      expect(p.list[0].api_key).toBe('[REDACTED]');

      // Non-sensitive data is preserved for forensic value
      expect(p.action).toBe('probe');
      expect(p.nested.deep.keep).toBe('visible');
      expect(p.list[1].safe).toBe('yes');

      // No secret survives anywhere in the serialized payload
      const raw = JSON.stringify(p);
      expect(raw).not.toContain('super-secret');
      expect(raw).not.toContain('rt-value');
      expect(raw).not.toContain('Bearer abc');
      expect(raw).not.toContain('k1');
    });

    it('L4-a. authentication audit payloads carry no session identifier', async () => {
      const authLogs = await prisma.auditLog.findMany({
        where: { entity_type: 'AUTHENTICATION' },
      });
      expect(authLogs.length).toBeGreaterThan(0);
      for (const log of authLogs) {
        const raw = JSON.stringify(log.payload);
        expect(raw).not.toMatch(/session_id/i);
      }
    });

    it('L4-b. no audit payload anywhere contains credential material', async () => {
      const all = await prisma.auditLog.findMany();
      for (const log of all) {
        const raw = JSON.stringify(log.payload);
        expect(raw).not.toContain(PASSWORD);
        expect(raw).not.toMatch(/\$2[aby]\$/); // bcrypt hash prefix
      }
    });
  });
});

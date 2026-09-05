import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import * as bcrypt from 'bcrypt';
import { CompanyStatus } from '@samco/database';
import { describe, it, beforeAll, expect } from 'vitest';

const PASSWORD = 'TestPassword123!';
const SALT = 10;

describe('AuditLogsModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminUser: any;
  let normalUser: any;
  let companyA: any;
  let companyB: any;

  let adminToken: string;
  let normalToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Clean DB
    await prisma.userBranchRole.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.companyMembership.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.role.deleteMany();
    await prisma.branch.deleteMany();
    await prisma.user.deleteMany();
    await prisma.company.deleteMany();

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

    // Create Company via API to trigger audits (does not require company permission yet)
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

    // Set up permissions and roles for adminUser
    const perms = ['companies.update', 'branches.create', 'audit_logs.view'];
    const permRecords = await Promise.all(
      perms.map(async (name) => {
        let p = await prisma.permission.findUnique({ where: { name } });
        if (!p) {
          p = await prisma.permission.create({ data: { name, description: name, module: 'Test' } });
        }
        return p;
      })
    );

    const adminRole = await prisma.role.create({
      data: { company_id: companyA.id, name: 'AdminRole' },
    });

    await prisma.rolePermission.createMany({
      data: permRecords.map((p) => ({ role_id: adminRole.id, permission_id: p.id })),
    });

    // Create a default branch to assign the role (since roles are assigned at branches)
    const defaultBranch = await prisma.branch.create({
      data: { company_id: companyA.id, name: 'Default', timezone: 'UTC' },
    });

    await prisma.userBranchRole.create({
      data: { user_id: adminUser.id, branch_id: defaultBranch.id, role_id: adminRole.id },
    });
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
        .send({ status: CompanyStatus.INACTIVE });

      expect(res.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: { event_type: 'UPDATE', entity_type: 'COMPANY', company_id: companyA.id },
      });
      expect(audit).toBeDefined();
      expect((audit!.payload as any).changed_fields).toContain('status');
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
        orderBy: { created_at: 'desc' }
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
      // normalUser doesn't have the permission in companyB (or companyA)
      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${normalToken}`)
        .set('X-Company-ID', companyB.id)
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
      // Verify no passwords exist in payload
      res.body.data.forEach((log: any) => {
        const payloadStr = JSON.stringify(log.payload);
        expect(payloadStr).not.toContain(PASSWORD);
      });
    });
  });

  describe('Append-only Protections', () => {
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
});

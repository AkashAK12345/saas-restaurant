/**
 * T0-A — Minimum domain foundations for Phases 7–10:
 *
 *   Customer       company-scoped
 *   Table          branch-scoped
 *   DisplayDevice  branch-scoped screen credential + its own auth path
 *   /auth/context  frontend shell projection
 *
 * Fixture:
 *   companyA ─ branchA  ─ adminA (all T0-A perms + branches.view)
 *            │          └ restrictedA (view-only T0-A perms)
 *            └ branchA2 (nobody holds a role here)
 *   companyB ─ branchB  ─ adminB (all T0-A perms)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import * as bcrypt from 'bcrypt';
import {
  MembershipStatus,
  CompanyStatus,
  BranchStatus,
} from '@samco/database';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const ALL_T0A_PERMS = [
  'customers.view', 'customers.create', 'customers.update',
  'tables.view', 'tables.create', 'tables.update',
  'display_devices.view', 'display_devices.create', 'display_devices.revoke',
  'branches.view',
];
const VIEW_ONLY_PERMS = ['customers.view', 'tables.view', 'display_devices.view'];

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

describe('T0-A Foundations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let companyA: any, companyB: any;
  let branchA: any, branchA2: any, branchB: any;
  let adminA: any, restrictedA: any, adminB: any;
  let adminTokenA: string, restrictedTokenA: string, adminTokenB: string;

  const asA = (req: request.Test, token = adminTokenA, branch?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyA.id);
    if (branch) req.set('X-Branch-ID', branch);
    return req;
  };
  const asB = (req: request.Test, branch?: string) => {
    req.set('Authorization', `Bearer ${adminTokenB}`).set('X-Company-ID', companyB.id);
    if (branch) req.set('X-Branch-ID', branch);
    return req;
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
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const hash = await bcrypt.hash(PASSWORD, SALT);

    companyA = await prisma.company.create({ data: { name: 'Found Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Found Beta', status: CompanyStatus.ACTIVE } });
    branchA = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha HQ', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA2 = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Two', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchB = await prisma.branch.create({ data: { company_id: companyB.id, name: 'Beta HQ', timezone: 'UTC', status: BranchStatus.ACTIVE } });

    const perms = await prisma.permission.findMany({ where: { name: { in: ALL_T0A_PERMS } } });
    const byName = new Map(perms.map((p) => [p.name, p.id]));
    expect(perms).toHaveLength(ALL_T0A_PERMS.length); // seed sanity

    const adminRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Admin' } });
    const restrictedRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Viewer' } });
    const adminRoleB = await prisma.role.create({ data: { company_id: companyB.id, name: 'Admin' } });

    await prisma.rolePermission.createMany({
      data: ALL_T0A_PERMS.map((n) => ({ role_id: adminRoleA.id, permission_id: byName.get(n)! })),
    });
    await prisma.rolePermission.createMany({
      data: VIEW_ONLY_PERMS.map((n) => ({ role_id: restrictedRoleA.id, permission_id: byName.get(n)! })),
    });
    await prisma.rolePermission.createMany({
      data: ALL_T0A_PERMS.map((n) => ({ role_id: adminRoleB.id, permission_id: byName.get(n)! })),
    });

    adminA = await prisma.user.create({ data: { email: 'found-admin-a@test.com', password_hash: hash } });
    restrictedA = await prisma.user.create({ data: { email: 'found-restricted-a@test.com', password_hash: hash } });
    adminB = await prisma.user.create({ data: { email: 'found-admin-b@test.com', password_hash: hash } });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: adminA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: restrictedA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: adminB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: adminA.id, branch_id: branchA.id, role_id: adminRoleA.id },
        { user_id: restrictedA.id, branch_id: branchA.id, role_id: restrictedRoleA.id },
        { user_id: adminB.id, branch_id: branchB.id, role_id: adminRoleB.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body
        .accessToken as string;
    adminTokenA = await login('found-admin-a@test.com');
    restrictedTokenA = await login('found-restricted-a@test.com');
    adminTokenB = await login('found-admin-b@test.com');
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Customer', () => {
    it('CU-1. create with a phone; phone is stored normalized', async () => {
      const res = await asA(request(http).post('/api/v1/customers')).send({
        name: 'Asha Rao',
        phone: '+91 98765-43210',
      });
      expect(res.status).toBe(201);
      expect(res.body.company_id).toBe(companyA.id);
      expect(res.body.phone).toBe('+919876543210');
      expect(res.body.status).toBe('ACTIVE');

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'CUSTOMER', entity_id: res.body.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.event_type).toBe('CREATE');
      // Phone is PII and is kept out of the audit payload.
      expect(JSON.stringify(audit!.payload)).not.toContain('9876543210');
      expect((audit!.payload as any).has_phone).toBe(true);
    });

    it('CU-2. create without a phone (walk-in) is allowed, repeatedly', async () => {
      const a = await asA(request(http).post('/api/v1/customers')).send({ name: 'Walk-in One' });
      const b = await asA(request(http).post('/api/v1/customers')).send({ name: 'Walk-in Two' });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.phone).toBeNull();
      expect(b.body.phone).toBeNull();
    });

    it('CU-3. read and list are company-scoped', async () => {
      const created = await asA(request(http).post('/api/v1/customers')).send({ name: 'Readable' });

      const one = await asA(request(http).get(`/api/v1/customers/${created.body.id}`));
      expect(one.status).toBe(200);
      expect(one.body.id).toBe(created.body.id);

      const list = await asA(request(http).get('/api/v1/customers').query({ limit: 100 }));
      expect(list.status).toBe(200);
      expect(list.body.meta).toMatchObject({ limit: 100, offset: 0 });
      expect(list.body.data.map((c: any) => c.id)).toContain(created.body.id);
      list.body.data.forEach((c: any) => expect(c.company_id).toBe(companyA.id));
    });

    it('CU-4. update name, status, and phone (including clearing it)', async () => {
      const created = await asA(request(http).post('/api/v1/customers')).send({
        name: 'Before',
        phone: '9000000001',
      });

      const res = await asA(request(http).patch(`/api/v1/customers/${created.body.id}`)).send({
        name: 'After',
        status: 'INACTIVE',
        phone: '(0141) 234-5678',
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('After');
      expect(res.body.status).toBe('INACTIVE');
      expect(res.body.phone).toBe('01412345678');

      const cleared = await asA(request(http).patch(`/api/v1/customers/${created.body.id}`)).send({
        phone: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.phone).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'CUSTOMER', entity_id: created.body.id, event_type: 'UPDATE' },
      });
      expect((audit!.payload as any).changed_fields).toEqual(
        expect.arrayContaining(['name', 'status', 'phone']),
      );
    });

    it('CU-5. duplicate normalized phone within a company is a 409', async () => {
      await asA(request(http).post('/api/v1/customers'))
        .send({ name: 'First', phone: '+91 91111 11111' })
        .expect(201);

      const dup = await asA(request(http).post('/api/v1/customers')).send({
        name: 'Second',
        phone: '+91-91111-11111', // same number, different formatting
      });
      expect(dup.status).toBe(409);
    });

    it('CU-6. duplicate via update is also a 409', async () => {
      const a = await asA(request(http).post('/api/v1/customers')).send({ name: 'A', phone: '9222222222' });
      const b = await asA(request(http).post('/api/v1/customers')).send({ name: 'B', phone: '9333333333' });
      const res = await asA(request(http).patch(`/api/v1/customers/${b.body.id}`)).send({
        phone: '92 2222 2222',
      });
      expect(res.status).toBe(409);
      const unchanged = await prisma.customer.findUnique({ where: { id: b.body.id } });
      expect(unchanged!.phone).toBe('9333333333');
      expect(a.status).toBe(201);
    });

    it('CU-7. the same phone in a DIFFERENT company is allowed', async () => {
      const inA = await asA(request(http).post('/api/v1/customers')).send({ name: 'Shared A', phone: '9444444444' });
      const inB = await asB(request(http).post('/api/v1/customers')).send({ name: 'Shared B', phone: '9444444444' });
      expect(inA.status).toBe(201);
      expect(inB.status).toBe(201);
      expect(inA.body.company_id).toBe(companyA.id);
      expect(inB.body.company_id).toBe(companyB.id);
    });

    it('CU-8. company isolation: B cannot read, list, or update A\'s customer', async () => {
      const created = await asA(request(http).post('/api/v1/customers')).send({ name: 'Private A' });

      expect((await asB(request(http).get(`/api/v1/customers/${created.body.id}`))).status).toBe(404);
      expect(
        (await asB(request(http).patch(`/api/v1/customers/${created.body.id}`)).send({ name: 'Hacked' }))
          .status,
      ).toBe(404);

      const list = await asB(request(http).get('/api/v1/customers').query({ limit: 100 }));
      expect(list.body.data.map((c: any) => c.id)).not.toContain(created.body.id);

      const untouched = await prisma.customer.findUnique({ where: { id: created.body.id } });
      expect(untouched!.name).toBe('Private A');
    });

    it('CU-9. X-Company-ID is context, not proof: A\'s admin cannot act in B', async () => {
      const res = await request(http)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id)
        .send({ name: 'Smuggled' });
      expect(res.status).toBe(403);
    });

    it('CU-10. invalid DTOs are 400', async () => {
      const cases = [
        { name: '' },
        { name: 'x'.repeat(201) },
        { name: 'Ok', phone: '12345' },
        { name: 'Ok', phone: 'abc' },
        { name: 'Ok', phone: '+91 98765 43210 ext 5' },
        { name: 'Ok', company_id: companyB.id }, // forbidNonWhitelisted
        { name: 'Ok', status: 'BANNED' },
      ];
      for (const body of cases) {
        const res = await asA(request(http).post('/api/v1/customers')).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect((await asA(request(http).get('/api/v1/customers/not-a-uuid'))).status).toBe(400);
      expect((await asA(request(http).get('/api/v1/customers').query({ limit: 999 }))).status).toBe(400);
    });

    it('CU-11. authorization: no token → 401; view-only role → 403 on create/update', async () => {
      expect((await request(http).get('/api/v1/customers')).status).toBe(401);

      const created = await asA(request(http).post('/api/v1/customers')).send({ name: 'Target' });
      expect(
        (await asA(request(http).post('/api/v1/customers'), restrictedTokenA).send({ name: 'Nope' })).status,
      ).toBe(403);
      expect(
        (await asA(request(http).patch(`/api/v1/customers/${created.body.id}`), restrictedTokenA).send({ name: 'Nope' }))
          .status,
      ).toBe(403);
      // ...but view-only CAN read.
      expect((await asA(request(http).get(`/api/v1/customers/${created.body.id}`), restrictedTokenA)).status).toBe(200);
    });

    it('CU-12. search by name or phone digits and filter by status, never beyond the company', async () => {
      const hit = await asA(request(http).post('/api/v1/customers')).send({ name: 'Searchable Sunita', phone: '+91 98111 22333' });
      const inactive = await asA(request(http).post('/api/v1/customers')).send({ name: 'Searchable Inactive' });
      await asA(request(http).patch(`/api/v1/customers/${inactive.body.id}`)).send({ status: 'INACTIVE' });
      await asB(request(http).post('/api/v1/customers')).send({ name: 'Searchable Beta', phone: '9811122333' });

      const byName = await asA(request(http).get('/api/v1/customers').query({ q: 'searchable s' }));
      expect(byName.status).toBe(200);
      expect(byName.body.data.map((c: any) => c.id)).toEqual([hit.body.id]);
      expect(byName.body.meta.total).toBe(1);

      const byPhone = await asA(request(http).get('/api/v1/customers').query({ q: '11122' }));
      expect(byPhone.body.data.map((c: any) => c.id)).toEqual([hit.body.id]);

      const onlyInactive = await asA(request(http).get('/api/v1/customers').query({ q: 'Searchable', status: 'INACTIVE' }));
      expect(onlyInactive.body.data.map((c: any) => c.id)).toEqual([inactive.body.id]);

      // A LIKE wildcard is data, not a pattern that widens the match.
      const wildcard = await asA(request(http).get('/api/v1/customers').query({ q: '%' }));
      expect(wildcard.status).toBe(200);
      expect(wildcard.body.data.every((c: any) => c.name.includes('%'))).toBe(true);

      expect((await asA(request(http).get('/api/v1/customers').query({ q: 'x'.repeat(101) }))).status).toBe(400);
      expect((await asA(request(http).get('/api/v1/customers').query({ status: 'BANNED' }))).status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Table', () => {
    it('TB-1. create under the authorized branch; branch comes from context, not body', async () => {
      const res = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({
        label: 'T1',
        capacity: 4,
        zone: 'Window',
      });
      expect(res.status).toBe(201);
      expect(res.body.branch_id).toBe(branchA.id);
      expect(res.body).toMatchObject({ label: 'T1', capacity: 4, zone: 'Window', status: 'ACTIVE' });

      const audit = await prisma.auditLog.findFirst({ where: { entity_type: 'TABLE', entity_id: res.body.id } });
      expect(audit!.branch_id).toBe(branchA.id);
      expect(audit!.company_id).toBe(companyA.id);
    });

    it('TB-2. read and list are branch-scoped', async () => {
      const created = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'T2', capacity: 2 });
      const one = await asA(request(http).get(`/api/v1/tables/${created.body.id}`), adminTokenA, branchA.id);
      expect(one.status).toBe(200);

      const list = await asA(request(http).get('/api/v1/tables').query({ limit: 100 }), adminTokenA, branchA.id);
      expect(list.status).toBe(200);
      expect(list.body.data.map((t: any) => t.id)).toContain(created.body.id);
      list.body.data.forEach((t: any) => expect(t.branch_id).toBe(branchA.id));
    });

    it('TB-3. update label, capacity, zone (clearable) and status', async () => {
      const created = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'T3', capacity: 2, zone: 'Bar' });
      const res = await asA(request(http).patch(`/api/v1/tables/${created.body.id}`), adminTokenA, branchA.id).send({
        label: 'T3b',
        capacity: 6,
        zone: null,
        status: 'INACTIVE',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ label: 'T3b', capacity: 6, zone: null, status: 'INACTIVE' });
    });

    it('TB-4. duplicate label within a branch is a 409; same label at another branch is fine', async () => {
      await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'DUP', capacity: 2 }).expect(201);
      expect(
        (await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'DUP', capacity: 2 })).status,
      ).toBe(409);
      // Same label, different company/branch.
      expect((await asB(request(http).post('/api/v1/tables'), branchB.id).send({ label: 'DUP', capacity: 2 })).status).toBe(201);
    });

    it('TB-5. branch isolation within the same company: no role at branchA2 → 403', async () => {
      // adminA holds tables.* at branchA only. X-Branch-ID is a claim; the
      // guard checks the role at THAT branch and finds none.
      const res = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA2.id).send({ label: 'X', capacity: 2 });
      expect(res.status).toBe(403);
      expect((await asA(request(http).get('/api/v1/tables'), adminTokenA, branchA2.id)).status).toBe(403);
      const leaked = await prisma.table.findFirst({ where: { branch_id: branchA2.id } });
      expect(leaked).toBeNull();
    });

    it('TB-6. cross-company: B cannot read/update A\'s table, and A\'s branch cannot be claimed under B', async () => {
      const created = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'T6', capacity: 2 });

      // B, in their own branch, asking for A's table id → 404
      expect((await asB(request(http).get(`/api/v1/tables/${created.body.id}`), branchB.id)).status).toBe(404);
      expect(
        (await asB(request(http).patch(`/api/v1/tables/${created.body.id}`), branchB.id).send({ label: 'H' })).status,
      ).toBe(404);

      // B claiming A's branch under B's company → guard rejects (branch not in company)
      expect((await asB(request(http).get('/api/v1/tables'), branchA.id)).status).toBe(403);
    });

    it('TB-7. invalid capacity, label, zone and UUIDs are 400', async () => {
      const bad = [
        { label: 'X', capacity: 0 },
        { label: 'X', capacity: -1 },
        { label: 'X', capacity: 1.5 },
        { label: 'X', capacity: 'four' },
        { label: 'X', capacity: 501 },
        { label: '', capacity: 2 },
        { label: 'x'.repeat(51), capacity: 2 },
        { label: 'X', capacity: 2, zone: 'z'.repeat(101) },
        { label: 'X', capacity: 2, branch_id: branchA2.id }, // forbidNonWhitelisted
        { label: 'X', capacity: 2, status: 'BROKEN' },
      ];
      for (const body of bad) {
        const res = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect((await asA(request(http).get('/api/v1/tables/not-a-uuid'), adminTokenA, branchA.id)).status).toBe(400);
    });

    it('TB-8. missing X-Branch-ID → 403; view-only role → 403 on write, 200 on read', async () => {
      expect((await asA(request(http).get('/api/v1/tables'))).status).toBe(403);

      const created = await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'T8', capacity: 2 });
      expect((await asA(request(http).post('/api/v1/tables'), restrictedTokenA, branchA.id).send({ label: 'N', capacity: 2 })).status).toBe(403);
      expect(
        (await asA(request(http).patch(`/api/v1/tables/${created.body.id}`), restrictedTokenA, branchA.id).send({ label: 'N' })).status,
      ).toBe(403);
      expect((await asA(request(http).get(`/api/v1/tables/${created.body.id}`), restrictedTokenA, branchA.id)).status).toBe(200);
    });

    it('TB-9. an INACTIVE branch rejects table operations (H4 still holds)', async () => {
      await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.INACTIVE } });
      try {
        expect((await asA(request(http).get('/api/v1/tables'), adminTokenA, branchA.id)).status).toBe(403);
      } finally {
        await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.ACTIVE } });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPLAY DEVICE — staff management + device authentication
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DisplayDevice', () => {
    const pair = (kind: string, name = 'Screen', token = adminTokenA, branch = branchA.id) =>
      asA(request(http).post('/api/v1/display-devices'), token, branch).send({ name, kind });

    const asDevice = (credential: string | undefined, branch: string | undefined, path = '/api/v1/display/me') => {
      const req = request(http).get(path);
      if (credential !== undefined) req.set('Authorization', `Display ${credential}`);
      if (branch) req.set('X-Branch-ID', branch);
      return req;
    };

    it('DD-1. pairing returns the raw credential once, alongside a hash-free device projection', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Lobby Board');
      expect(res.status).toBe(201);
      expect(res.body.credential).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      expect(res.body.device).toMatchObject({ name: 'Lobby Board', kind: 'QUEUE_CUSTOMER', status: 'ACTIVE', branch_id: branchA.id });
      expect(res.body.device).not.toHaveProperty('credential_hash');
      expect(JSON.stringify(res.body.device)).not.toContain(res.body.credential.split('.')[1]);
    });

    it('DD-2. only the SHA-256 of the secret is persisted — never the raw value', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Persist Check');
      const [id, secret] = res.body.credential.split('.');
      const row = await prisma.displayDevice.findUnique({ where: { id } });
      expect(row!.credential_hash).toBe(sha256(secret));
      expect(row!.credential_hash).not.toBe(secret);
      expect(row!.credential_hash).not.toBe(res.body.credential);
    });

    it('DD-3. list and get never expose credential_hash', async () => {
      const res = await pair('QUEUE_ADMIN', 'Back Office');
      const one = await asA(request(http).get(`/api/v1/display-devices/${res.body.device.id}`), adminTokenA, branchA.id);
      expect(one.status).toBe(200);
      expect(one.body).not.toHaveProperty('credential_hash');
      expect(one.body).not.toHaveProperty('credential');

      const list = await asA(request(http).get('/api/v1/display-devices').query({ limit: 100 }), adminTokenA, branchA.id);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      list.body.data.forEach((d: any) => {
        expect(d).not.toHaveProperty('credential_hash');
        expect(d.branch_id).toBe(branchA.id);
      });
    });

    it('DD-4. a valid credential authenticates for its own branch', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Auth OK');
      const me = await asDevice(res.body.credential, branchA.id);
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ id: res.body.device.id, branch_id: branchA.id, kind: 'QUEUE_CUSTOMER' });
    });

    it('DD-5. invalid credentials are rejected with a generic 401', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Bad Cred');
      const [id] = res.body.credential.split('.');
      const cases: Array<[string | undefined, string | undefined]> = [
        [`${id}.${'0'.repeat(64)}`, branchA.id], // wrong secret
        [`${id}.`, branchA.id], // empty secret
        [id, branchA.id], // no secret at all
        ['garbage', branchA.id],
        [`00000000-0000-4000-8000-000000000000.${'a'.repeat(64)}`, branchA.id], // unknown device
        [undefined, branchA.id], // missing header
        [res.body.credential, undefined], // missing X-Branch-ID
      ];
      for (const [cred, branch] of cases) {
        const r = await asDevice(cred, branch);
        expect(r.status, `${cred} / ${branch}`).toBe(401);
        expect(r.body.message).toBe('Invalid display credential');
      }
    });

    it('DD-6. a staff JWT cannot use the display path, and a display credential cannot use staff routes', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Cross Path');
      // Staff JWT on the device route — separate trust path.
      const staff = await request(http)
        .get('/api/v1/display/me')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Branch-ID', branchA.id);
      expect(staff.status).toBe(401);
      // Device credential on a staff route — never becomes a user.
      const dev = await request(http)
        .get('/api/v1/tables')
        .set('Authorization', `Display ${res.body.credential}`)
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);
      expect(dev.status).toBe(401);
    });

    it('DD-7. revocation stops authentication immediately and is audited', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'To Revoke');
      const deviceId = res.body.device.id;
      expect((await asDevice(res.body.credential, branchA.id)).status).toBe(200);

      const revoke = await asA(request(http).post(`/api/v1/display-devices/${deviceId}/revoke`), adminTokenA, branchA.id);
      expect(revoke.status).toBe(200);
      expect(revoke.body.status).toBe('REVOKED');
      expect(revoke.body.revoked_at).not.toBeNull();
      expect(revoke.body).not.toHaveProperty('credential_hash');

      expect((await asDevice(res.body.credential, branchA.id)).status).toBe(401);

      // Revoking twice is a 409, not a second audit row.
      expect((await asA(request(http).post(`/api/v1/display-devices/${deviceId}/revoke`), adminTokenA, branchA.id)).status).toBe(409);

      const audits = await prisma.auditLog.findMany({ where: { entity_type: 'DISPLAY_DEVICE', entity_id: deviceId } });
      const actions = audits.map((a) => (a.payload as any).action).sort();
      expect(actions).toEqual(['device_paired', 'device_revoked']);
      audits.forEach((a) => {
        expect(a.event_type).toBe('SECURITY');
        expect(a.branch_id).toBe(branchA.id);
        const raw = JSON.stringify(a.payload);
        expect(raw).not.toContain(res.body.credential.split('.')[1]);
        expect(raw).not.toMatch(/credential|hash/i);
      });
    });

    it('DD-8. a device paired to branchA cannot authenticate for branchA2 or branchB', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Branch Bound');
      expect((await asDevice(res.body.credential, branchA2.id)).status).toBe(401);
      expect((await asDevice(res.body.credential, branchB.id)).status).toBe(401);
      expect((await asDevice(res.body.credential, branchA.id)).status).toBe(200);
    });

    it('DD-9. display-kind restrictions are enforced per route', async () => {
      const customer = await pair('QUEUE_CUSTOMER', 'Kind C');
      const admin = await pair('QUEUE_ADMIN', 'Kind A');
      const chef = await pair('BANQUET_CHEF', 'Kind K');

      // /display/me: any kind
      for (const d of [customer, admin, chef]) {
        expect((await asDevice(d.body.credential, branchA.id)).status).toBe(200);
      }
      // /display/branch: every board-rendering kind may title itself. Phase 8
      // added BANQUET_CHEF here when the chef display began showing its branch.
      const c = await asDevice(customer.body.credential, branchA.id, '/api/v1/display/branch');
      expect(c.status).toBe(200);
      expect(c.body).toEqual({ id: branchA.id, name: 'Alpha HQ', timezone: 'Asia/Kolkata' });
      for (const d of [admin, chef]) {
        expect((await asDevice(d.body.credential, branchA.id, '/api/v1/display/branch')).status).toBe(200);
      }

      // The BOARD routes are where a kind actually gates data, and they stay
      // mutually exclusive: a queue screen can never render the kitchen, and a
      // kitchen screen can never render the queue.
      for (const d of [customer, admin]) {
        expect(
          (await asDevice(d.body.credential, branchA.id, '/api/v1/display/banquet/board')).status,
        ).toBe(403);
      }
      expect(
        (await asDevice(chef.body.credential, branchA.id, '/api/v1/display/queue/board')).status,
      ).toBe(403);
    });

    it('DD-10. an INACTIVE branch or non-ACTIVE company stops its devices', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Lifecycle');
      await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.INACTIVE } });
      try {
        expect((await asDevice(res.body.credential, branchA.id)).status).toBe(401);
      } finally {
        await prisma.branch.update({ where: { id: branchA.id }, data: { status: BranchStatus.ACTIVE } });
      }
      await prisma.company.update({ where: { id: companyA.id }, data: { status: CompanyStatus.SUSPENDED } });
      try {
        expect((await asDevice(res.body.credential, branchA.id)).status).toBe(401);
      } finally {
        await prisma.company.update({ where: { id: companyA.id }, data: { status: CompanyStatus.ACTIVE } });
      }
      expect((await asDevice(res.body.credential, branchA.id)).status).toBe(200);
    });

    it('DD-11. staff authorization: view-only cannot pair/revoke; B cannot see or revoke A\'s device', async () => {
      const res = await pair('QUEUE_CUSTOMER', 'Managed');
      const id = res.body.device.id;

      expect((await pair('QUEUE_CUSTOMER', 'Nope', restrictedTokenA)).status).toBe(403);
      expect((await asA(request(http).post(`/api/v1/display-devices/${id}/revoke`), restrictedTokenA, branchA.id)).status).toBe(403);
      expect((await asA(request(http).get(`/api/v1/display-devices/${id}`), restrictedTokenA, branchA.id)).status).toBe(200);

      expect((await asB(request(http).get(`/api/v1/display-devices/${id}`), branchB.id)).status).toBe(404);
      expect((await asB(request(http).post(`/api/v1/display-devices/${id}/revoke`), branchB.id)).status).toBe(404);
      // adminA has no role at branchA2 → cannot pair there
      expect((await pair('QUEUE_CUSTOMER', 'Nope', adminTokenA, branchA2.id)).status).toBe(403);

      const still = await prisma.displayDevice.findUnique({ where: { id } });
      expect(still!.status).toBe('ACTIVE');
    });

    it('DD-12. invalid pairing DTOs are 400', async () => {
      for (const body of [
        { name: '', kind: 'QUEUE_CUSTOMER' },
        { name: 'X', kind: 'POS_TERMINAL' },
        { name: 'X' },
        { name: 'X', kind: 'QUEUE_CUSTOMER', branch_id: branchB.id },
        { name: 'x'.repeat(101), kind: 'QUEUE_CUSTOMER' },
      ]) {
        const res = await asA(request(http).post('/api/v1/display-devices'), adminTokenA, branchA.id).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect((await asA(request(http).get('/api/v1/display-devices/nope'), adminTokenA, branchA.id)).status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /auth/context', () => {
    const ctx = (token: string, company?: string, branch?: string) => {
      const req = request(http).get('/api/v1/auth/context').set('Authorization', `Bearer ${token}`);
      if (company) req.set('X-Company-ID', company);
      if (branch) req.set('X-Branch-ID', branch);
      return req;
    };

    it('AC-1. without context: identity + selectable companies only', async () => {
      const res = await ctx(adminTokenA);
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: adminA.id, email: 'found-admin-a@test.com', first_name: null, last_name: null });
      expect(res.body.companies.map((c: any) => c.id)).toEqual([companyA.id]);
      expect(res.body.company).toBeNull();
      expect(res.body.branch).toBeNull();
    });

    it('AC-2. with company: branches, role flags and effective company permissions', async () => {
      const res = await ctx(adminTokenA, companyA.id);
      expect(res.status).toBe(200);
      expect(res.body.company.id).toBe(companyA.id);
      expect(res.body.company.branches.map((b: any) => [b.id, b.has_roles])).toEqual(
        expect.arrayContaining([[branchA.id, true], [branchA2.id, false]]),
      );
      expect(res.body.company.permissions).toEqual([...ALL_T0A_PERMS].sort());
      expect(res.body.branch).toBeNull();
    });

    it('AC-3. with branch: branch permissions differ by branch, and match the guard', async () => {
      const atA = await ctx(adminTokenA, companyA.id, branchA.id);
      expect(atA.status).toBe(200);
      expect(atA.body.branch.id).toBe(branchA.id);
      expect(atA.body.branch.permissions).toEqual([...ALL_T0A_PERMS].sort());

      const atA2 = await ctx(adminTokenA, companyA.id, branchA2.id);
      expect(atA2.status).toBe(200);
      expect(atA2.body.branch.permissions).toEqual([]);

      // What the context says, the guard does: tables.create present at A → 201; absent at A2 → 403.
      expect((await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA.id).send({ label: 'AC3', capacity: 2 })).status).toBe(201);
      expect((await asA(request(http).post('/api/v1/tables'), adminTokenA, branchA2.id).send({ label: 'AC3', capacity: 2 })).status).toBe(403);
    });

    it('AC-4. a view-only user sees only their view permissions', async () => {
      const res = await ctx(restrictedTokenA, companyA.id, branchA.id);
      expect(res.body.company.permissions).toEqual([...VIEW_ONLY_PERMS].sort());
      expect(res.body.branch.permissions).toEqual([...VIEW_ONLY_PERMS].sort());
    });

    it('AC-5. fabricated context is a 404 and discloses nothing', async () => {
      expect((await ctx(adminTokenA, companyB.id)).status).toBe(404);
      expect((await ctx(adminTokenA, companyA.id, branchB.id)).status).toBe(404);
      expect((await ctx(adminTokenA, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await ctx(adminTokenA, 'not-a-uuid')).status).toBe(404);
    });

    it('AC-6. the endpoint does not weaken backend authorization', async () => {
      // Even after "seeing" companyB is off-limits, nothing changes: guards still decide.
      await ctx(adminTokenA, companyB.id);
      const res = await request(http)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .set('X-Company-ID', companyB.id);
      expect(res.status).toBe(403);
    });

    it('AC-7. no sensitive material in the response', async () => {
      const res = await ctx(adminTokenA, companyA.id, branchA.id);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toMatch(/password|hash|token|session|secret|credential/i);
      expect(res.body.user).not.toHaveProperty('is_superadmin');
    });

    it('AC-8. unauthenticated → 401; a disabled user → 401', async () => {
      expect((await request(http).get('/api/v1/auth/context')).status).toBe(401);
      await prisma.user.update({ where: { id: restrictedA.id }, data: { status: 'INACTIVE' } });
      try {
        expect((await ctx(restrictedTokenA)).status).toBe(401);
      } finally {
        await prisma.user.update({ where: { id: restrictedA.id }, data: { status: 'ACTIVE' } });
      }
    });

    it('AC-9. /auth/me is unchanged (still profile-only)', async () => {
      const res = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminTokenA}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['email', 'first_name', 'id', 'is_superadmin', 'last_name']);
    });
  });
});

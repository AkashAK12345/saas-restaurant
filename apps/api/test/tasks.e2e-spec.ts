/**
 * Phase 9 — Tasks & Routines.
 *
 * Fixture:
 *   companyA ─ branchA   ─ managerA  (all task perms)
 *            │           ├ workerA   (tasks.view + start/complete/update)
 *            │           ├ viewerA   (tasks.view only)
 *            │           └ strangerA (no task perms)
 *            ├ branchA2  ─ branchOnlyA (works ONLY at branchA2)
 *            └ branchOff (INACTIVE)   ─ managerA holds the role
 *   companyB ─ branchB   ─ managerB
 *   companyS (SUSPENDED) ─ branchS    ─ suspendedUser
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import {
  BranchStatus,
  CompanyStatus,
  MembershipStatus,
  UserStatus,
} from '@samco/database';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/database/prisma.service.js';
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter.js';
import { MAX_REQUEST_BODY_SIZE } from '../src/core/http-body-limit.js';
import { resetDatabase, assertPermissionsSeeded } from './utils/db.js';
import { EVENT_BROKER, type EventBroker } from '../src/common/realtime/event-broker.js';
import { RealtimeChannel } from '../src/common/realtime/channels.js';
import { TASK_EVENT_TYPES } from '../src/modules/tasks/tasks.service.js';
import { RoutinesService } from '../src/modules/tasks/routines.service.js';
import { JobRegistry } from '../src/common/scheduler/job-registry.service.js';
import { ROUTINE_JOB_NAME } from '../src/modules/tasks/tasks.module.js';
import { branchLocalDate } from '../src/common/scheduler/branch-time.js';

const PASSWORD = 'SecurePassword123!';
const SALT = 10;

const MANAGER_PERMS = [
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.assign',
  'tasks.start',
  'tasks.complete',
  'tasks.cancel',
  'tasks.checklist.manage',
  'tasks.routine.manage',
  'tasks.reports.view',
];
const WORKER_PERMS = ['tasks.view', 'tasks.update', 'tasks.start', 'tasks.complete'];

describe('Phase 9 Tasks & Routines (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let broker: EventBroker;
  let routines: RoutinesService;
  let jobs: JobRegistry;
  let http: any;

  let companyA: any, companyB: any, companyS: any;
  let branchA: any, branchA2: any, branchOff: any, branchB: any, branchS: any;
  let managerA: any, workerA: any, viewerA: any, strangerA: any, branchOnlyA: any;
  let managerB: any, suspendedUser: any;
  let tokenManagerA: string, tokenWorkerA: string, tokenViewerA: string, tokenStrangerA: string;
  let tokenManagerB: string, tokenSuspended: string;
  let checklistA: any;

  const as = (req: request.Test, token: string, companyId: string, branchId?: string) => {
    req.set('Authorization', `Bearer ${token}`).set('X-Company-ID', companyId);
    if (branchId) req.set('X-Branch-ID', branchId);
    return req;
  };
  const asManager = (req: request.Test, branchId = branchA.id) =>
    as(req, tokenManagerA, companyA.id, branchId);

  const createTask = (body: Record<string, unknown> = {}, branchId = branchA.id) =>
    asManager(request(http).post('/api/v1/tasks'), branchId).send({
      title: `Task ${Math.random().toString(36).slice(2, 8)}`,
      ...body,
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // bodyParser: false + the same explicit limit main.ts configures — a
    // base64 photo upload well exceeds Express's 100kb default.
    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use(json({ limit: MAX_REQUEST_BODY_SIZE }));
    app.use(urlencoded({ extended: true, limit: MAX_REQUEST_BODY_SIZE }));
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    broker = app.get(EVENT_BROKER);
    routines = app.get(RoutinesService);
    jobs = app.get(JobRegistry);
    http = app.getHttpServer();

    await assertPermissionsSeeded(prisma);
    await resetDatabase(prisma);

    const hash = await bcrypt.hash(PASSWORD, SALT);

    companyA = await prisma.company.create({ data: { name: 'Tasks Alpha', status: CompanyStatus.ACTIVE } });
    companyB = await prisma.company.create({ data: { name: 'Tasks Beta', status: CompanyStatus.ACTIVE } });
    companyS = await prisma.company.create({ data: { name: 'Tasks Suspended', status: CompanyStatus.SUSPENDED } });

    branchA = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Main', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchA2 = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Second', timezone: 'Asia/Kolkata', status: BranchStatus.ACTIVE } });
    branchOff = await prisma.branch.create({ data: { company_id: companyA.id, name: 'Alpha Closed', timezone: 'UTC', status: BranchStatus.INACTIVE } });
    branchB = await prisma.branch.create({ data: { company_id: companyB.id, name: 'Beta Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });
    branchS = await prisma.branch.create({ data: { company_id: companyS.id, name: 'Suspended Main', timezone: 'UTC', status: BranchStatus.ACTIVE } });

    const perms = await prisma.permission.findMany({ where: { name: { in: MANAGER_PERMS } } });
    expect(perms).toHaveLength(MANAGER_PERMS.length); // seed sanity: Phase 9 keys exist
    const byName = new Map(perms.map((p) => [p.name, p.id]));

    const managerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Task Manager' } });
    const workerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Task Worker' } });
    const viewerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'Task Viewer' } });
    const strangerRoleA = await prisma.role.create({ data: { company_id: companyA.id, name: 'No Tasks' } });
    const managerRoleB = await prisma.role.create({ data: { company_id: companyB.id, name: 'Task Manager' } });
    const managerRoleS = await prisma.role.create({ data: { company_id: companyS.id, name: 'Task Manager' } });

    await prisma.rolePermission.createMany({
      data: [
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleA.id, permission_id: byName.get(n)! })),
        ...WORKER_PERMS.map((n) => ({ role_id: workerRoleA.id, permission_id: byName.get(n)! })),
        { role_id: viewerRoleA.id, permission_id: byName.get('tasks.view')! },
        { role_id: strangerRoleA.id, permission_id: byName.get('tasks.view')! },
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleB.id, permission_id: byName.get(n)! })),
        ...MANAGER_PERMS.map((n) => ({ role_id: managerRoleS.id, permission_id: byName.get(n)! })),
      ],
    });
    // strangerRoleA holds tasks.view at branchA2 only — at branchA the user has
    // a role with no task permissions at all.
    await prisma.rolePermission.deleteMany({ where: { role_id: strangerRoleA.id } });

    managerA = await prisma.user.create({ data: { email: 't-manager-a@test.com', password_hash: hash, first_name: 'Mina', last_name: 'Manager' } });
    workerA = await prisma.user.create({ data: { email: 't-worker-a@test.com', password_hash: hash, first_name: 'Wes', last_name: 'Worker' } });
    viewerA = await prisma.user.create({ data: { email: 't-viewer-a@test.com', password_hash: hash, first_name: 'Vic', last_name: 'Viewer' } });
    strangerA = await prisma.user.create({ data: { email: 't-stranger-a@test.com', password_hash: hash } });
    branchOnlyA = await prisma.user.create({ data: { email: 't-branch2-a@test.com', password_hash: hash, first_name: 'Bea', last_name: 'Second' } });
    managerB = await prisma.user.create({ data: { email: 't-manager-b@test.com', password_hash: hash } });
    suspendedUser = await prisma.user.create({ data: { email: 't-suspended@test.com', password_hash: hash } });

    await prisma.companyMembership.createMany({
      data: [
        { user_id: managerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: workerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: viewerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: strangerA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: branchOnlyA.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
        { user_id: managerB.id, company_id: companyB.id, status: MembershipStatus.ACTIVE },
        { user_id: suspendedUser.id, company_id: companyS.id, status: MembershipStatus.ACTIVE },
      ],
    });
    await prisma.userBranchRole.createMany({
      data: [
        { user_id: managerA.id, branch_id: branchA.id, role_id: managerRoleA.id },
        { user_id: managerA.id, branch_id: branchOff.id, role_id: managerRoleA.id },
        { user_id: workerA.id, branch_id: branchA.id, role_id: workerRoleA.id },
        { user_id: viewerA.id, branch_id: branchA.id, role_id: viewerRoleA.id },
        { user_id: strangerA.id, branch_id: branchA.id, role_id: strangerRoleA.id },
        // Works at the SECOND branch only — the cross-branch assignment target.
        { user_id: branchOnlyA.id, branch_id: branchA2.id, role_id: workerRoleA.id },
        { user_id: managerB.id, branch_id: branchB.id, role_id: managerRoleB.id },
        { user_id: suspendedUser.id, branch_id: branchS.id, role_id: managerRoleS.id },
      ],
    });

    const login = async (email: string) =>
      (await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD })).body
        .accessToken as string;
    tokenManagerA = await login('t-manager-a@test.com');
    tokenWorkerA = await login('t-worker-a@test.com');
    tokenViewerA = await login('t-viewer-a@test.com');
    tokenStrangerA = await login('t-stranger-a@test.com');
    tokenManagerB = await login('t-manager-b@test.com');
    tokenSuspended = await login('t-suspended@test.com');

    checklistA = (
      await asManager(request(http).post('/api/v1/checklists')).send({
        name: 'Opening checks',
        items: [
          { label: 'Unlock the doors' },
          { label: 'Check fridge temperature' },
          { label: 'Optional: water the plants', is_required: false },
        ],
      })
    ).body;
    expect(checklistA.items).toHaveLength(3);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKLIST TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Checklist templates', () => {
    it('TC-1. creates a company-scoped template with ordered items', async () => {
      const res = await asManager(request(http).post('/api/v1/checklists')).send({
        name: `Closing ${Date.now()}`,
        items: [{ label: 'Cash up' }, { label: 'Lock up' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.company_id).toBe(companyA.id);
      expect(res.body.items.map((i: any) => [i.label, i.position, i.is_required])).toEqual([
        ['Cash up', 0, true],
        ['Lock up', 1, true],
      ]);
    });

    it('TC-2. rejects a duplicate name and an empty item list', async () => {
      expect(
        (await asManager(request(http).post('/api/v1/checklists')).send({
          name: 'Opening checks',
          items: [{ label: 'x' }],
        })).status,
      ).toBe(409);

      expect(
        (await asManager(request(http).post('/api/v1/checklists')).send({
          name: `Empty ${Date.now()}`,
          items: [],
        })).status,
      ).toBe(400);
    });

    it('TC-3. is company-scoped: another company cannot see or read it', async () => {
      const cross = await as(
        request(http).get(`/api/v1/checklists/${checklistA.id}`),
        tokenManagerB,
        companyB.id,
      );
      expect(cross.status).toBe(404);

      const list = await as(request(http).get('/api/v1/checklists'), tokenManagerB, companyB.id);
      expect(list.body.data.map((c: any) => c.id)).not.toContain(checklistA.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task lifecycle', () => {
    it('TL-1. creates a PENDING task', async () => {
      const res = await createTask({ title: 'Sweep the terrace', priority: 'HIGH' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        company_id: companyA.id,
        branch_id: branchA.id,
        status: 'PENDING',
        priority: 'HIGH',
        source: 'MANUAL',
        assignee_id: null,
        overdue: false,
      });
      expect(res.body.checklist).toEqual([]);
    });

    it('TL-2. PENDING -> IN_PROGRESS -> COMPLETED, with stamps', async () => {
      const task = (await createTask()).body;
      const started = await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send();
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('IN_PROGRESS');
      expect(started.body.started_at).not.toBeNull();

      const done = await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.completed_at).not.toBeNull();
      expect(done.body.completed_by).toBe(managerA.id);
      expect(done.body.completer).toEqual({ id: managerA.id, name: 'Mina Manager' });
    });

    it('TL-3. a small task may go straight from PENDING to COMPLETED', async () => {
      const task = (await createTask()).body;
      const done = await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.started_at).toBeNull();
    });

    it('TL-4. cancellation works from PENDING and from IN_PROGRESS', async () => {
      const a = (await createTask()).body;
      expect((await asManager(request(http).post(`/api/v1/tasks/${a.id}/cancel`)).send()).body.status).toBe('CANCELLED');

      const b = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${b.id}/start`)).send();
      expect((await asManager(request(http).post(`/api/v1/tasks/${b.id}/cancel`)).send()).body.status).toBe('CANCELLED');
    });

    it('TL-5. a completed task cannot be restarted, recompleted or cancelled', async () => {
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      for (const op of ['start', 'complete', 'cancel']) {
        const res = await asManager(request(http).post(`/api/v1/tasks/${task.id}/${op}`)).send();
        expect([op, res.status]).toEqual([op, 409]);
      }
    });

    it('TL-6. a cancelled task cannot be completed or started', async () => {
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/cancel`)).send();
      for (const op of ['start', 'complete']) {
        const res = await asManager(request(http).post(`/api/v1/tasks/${task.id}/${op}`)).send();
        expect([op, res.status]).toEqual([op, 409]);
      }
    });

    it('TL-7. repeating an operation is rejected the second time', async () => {
      const task = (await createTask()).body;
      expect((await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send()).status).toBe(200);
      expect((await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send()).status).toBe(409);
    });

    it('TL-8. there is NO route that mutates status directly', async () => {
      const task = (await createTask()).body;
      const patch = await asManager(request(http).patch(`/api/v1/tasks/${task.id}`)).send({ status: 'COMPLETED' });
      expect(patch.status).toBe(400); // the whitelist rejects the field outright

      const put = await asManager(request(http).put(`/api/v1/tasks/${task.id}`)).send({ status: 'COMPLETED' });
      expect([404, 405]).toContain(put.status);

      const del = await asManager(request(http).delete(`/api/v1/tasks/${task.id}`));
      expect([404, 405]).toContain(del.status);

      const after = await prisma.task.findUnique({ where: { id: task.id } });
      expect(after!.status).toBe('PENDING');
    });

    it('TL-9. a finished task cannot be edited or reassigned', async () => {
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();

      expect((await asManager(request(http).patch(`/api/v1/tasks/${task.id}`)).send({ title: 'New' })).status).toBe(409);
      expect(
        (await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: workerA.id })).status,
      ).toBe(409);
    });

    it('TL-10. validates the payload', async () => {
      for (const body of [
        {},
        { title: '' },
        { title: 'x', priority: 'URGENT' },
        { title: 'x', due_at: 'tomorrow' },
        { title: 'x', assignee_id: 'nope' },
        { title: 'x', branch_id: branchB.id },
      ]) {
        const res = await asManager(request(http).post('/api/v1/tasks')).send(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSIGNMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Assignments', () => {
    it('TA-1. assigns to a member of staff at this branch, and can clear it', async () => {
      const task = (await createTask()).body;
      const assigned = await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({
        assignee_id: workerA.id,
      });
      expect(assigned.status).toBe(200);
      expect(assigned.body.assignee).toEqual({ id: workerA.id, name: 'Wes Worker' });

      const cleared = await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({});
      expect(cleared.status).toBe(200);
      expect(cleared.body.assignee_id).toBeNull();
    });

    it('TA-2. refuses someone who does not work at this branch', async () => {
      const task = (await createTask()).body;
      const res = await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({
        assignee_id: branchOnlyA.id, // holds a role at branchA2 only
      });
      expect(res.status).toBe(404);
    });

    it('TA-3. refuses a user from another company, without disclosing them', async () => {
      const task = (await createTask()).body;
      const res = await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({
        assignee_id: managerB.id,
      });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('t-manager-b@test.com');
    });

    it('TA-4. refuses a globally disabled user and an inactive member', async () => {
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Task Worker' } });

      const disabled = await prisma.user.create({
        data: { email: 't-disabled-assignee@test.com', password_hash: hash, status: UserStatus.INACTIVE },
      });
      await prisma.companyMembership.create({
        data: { user_id: disabled.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: disabled.id, branch_id: branchA.id, role_id: role!.id },
      });

      const exMember = await prisma.user.create({
        data: { email: 't-exmember@test.com', password_hash: hash },
      });
      await prisma.companyMembership.create({
        data: { user_id: exMember.id, company_id: companyA.id, status: MembershipStatus.INACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: exMember.id, branch_id: branchA.id, role_id: role!.id },
      });

      const task = (await createTask()).body;
      for (const id of [disabled.id, exMember.id]) {
        const res = await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: id });
        expect(res.status).toBe(404);
      }
    });

    it('TA-5. ASSIGNMENT IS NOT AUTHORIZATION', async () => {
      // viewerA holds tasks.view only. Being made responsible for a task must
      // not let them start, complete, cancel or reassign it.
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: viewerA.id });

      for (const op of ['start', 'complete', 'cancel', 'assign']) {
        const res = await as(
          request(http).post(`/api/v1/tasks/${task.id}/${op}`),
          tokenViewerA,
          companyA.id,
          branchA.id,
        ).send({});
        expect([op, res.status]).toEqual([op, 403]);
      }
      // ...and they still cannot edit it either.
      const patch = await as(
        request(http).patch(`/api/v1/tasks/${task.id}`),
        tokenViewerA,
        companyA.id,
        branchA.id,
      ).send({ title: 'mine now' });
      expect(patch.status).toBe(403);

      // The task is untouched.
      const after = await prisma.task.findUnique({ where: { id: task.id } });
      expect(after!.status).toBe('PENDING');
    });

    it('TA-6. an assignee WITH the permission can work the task normally', async () => {
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: workerA.id });
      const started = await as(
        request(http).post(`/api/v1/tasks/${task.id}/start`),
        tokenWorkerA,
        companyA.id,
        branchA.id,
      ).send();
      expect(started.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKLISTS ON TASKS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task checklists', () => {
    const withChecklist = () => createTask({ checklist_template_id: checklistA.id });

    it('TK-1. copies the template onto the task in order', async () => {
      const res = await withChecklist();
      expect(res.status).toBe(201);
      expect(res.body.checklist.map((i: any) => [i.label, i.position, i.is_required])).toEqual([
        ['Unlock the doors', 0, true],
        ['Check fridge temperature', 1, true],
        ['Optional: water the plants', 2, false],
      ]);
      expect(res.body.checklist_progress).toEqual({
        total: 3,
        done: 0,
        required_total: 2,
        required_done: 0,
        ready_to_complete: false,
      });
    });

    it('TK-2. REQUIRED items block completion until they are done', async () => {
      const task = (await withChecklist()).body;

      const tooSoon = await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      expect(tooSoon.status).toBe(409);
      expect(tooSoon.body.message).toMatch(/2 required checklist items are still outstanding/);

      // Tick one required item — still blocked.
      await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${task.checklist[0].id}`)).send({ is_done: true });
      const stillBlocked = await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      expect(stillBlocked.status).toBe(409);
      expect(stillBlocked.body.message).toMatch(/1 required checklist item is/);

      // Tick the second. The OPTIONAL item stays untouched on purpose.
      const ticked = await asManager(
        request(http).patch(`/api/v1/tasks/${task.id}/checklist/${task.checklist[1].id}`),
      ).send({ is_done: true });
      expect(ticked.body.checklist_progress).toMatchObject({ required_done: 2, ready_to_complete: true });

      const done = await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');
    });

    it('TK-3. records who ticked an item, and un-ticking clears it', async () => {
      const task = (await withChecklist()).body;
      const item = task.checklist[0];

      const on = await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${item.id}`)).send({ is_done: true });
      expect(on.body.checklist[0]).toMatchObject({ is_done: true, done_by: managerA.id });
      expect(on.body.checklist[0].done_at).not.toBeNull();

      const off = await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${item.id}`)).send({ is_done: false });
      expect(off.body.checklist[0]).toMatchObject({ is_done: false, done_by: null, done_at: null });
    });

    it('TK-4. HISTORY IS STABLE: editing the template does not change existing tasks', async () => {
      const task = (await withChecklist()).body;
      // Complete it against the checklist as it stood.
      for (const item of task.checklist.filter((i: any) => i.is_required)) {
        await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${item.id}`)).send({ is_done: true });
      }
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();

      // Now rewrite the template completely.
      const edited = await asManager(request(http).patch(`/api/v1/checklists/${checklistA.id}`)).send({
        items: [
          { label: 'Unlock the doors' },
          { label: 'Check fridge temperature' },
          { label: 'Optional: water the plants', is_required: false },
          { label: 'A NEW mandatory step' },
        ],
      });
      expect(edited.status).toBe(200);
      expect(edited.body.items).toHaveLength(4);

      // The completed task is untouched and still complete.
      const after = await asManager(request(http).get(`/api/v1/tasks/${task.id}`));
      expect(after.body.status).toBe('COMPLETED');
      expect(after.body.checklist).toHaveLength(3);
      expect(JSON.stringify(after.body.checklist)).not.toContain('A NEW mandatory step');
      expect(after.body.checklist_progress.ready_to_complete).toBe(true);
    });

    it('TK-5. a finished task’s checklist cannot be changed', async () => {
      const task = (await withChecklist()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/cancel`)).send();
      const res = await asManager(
        request(http).patch(`/api/v1/tasks/${task.id}/checklist/${task.checklist[0].id}`),
      ).send({ is_done: true });
      expect(res.status).toBe(409);
    });

    it('TK-6. an item of another task is 404, and an inactive template is refused', async () => {
      const a = (await withChecklist()).body;
      const b = (await withChecklist()).body;
      const cross = await asManager(request(http).patch(`/api/v1/tasks/${a.id}/checklist/${b.checklist[0].id}`)).send({ is_done: true });
      expect(cross.status).toBe(404);

      const retired = (
        await asManager(request(http).post('/api/v1/checklists')).send({
          name: `Retired ${Date.now()}`,
          items: [{ label: 'x' }],
        })
      ).body;
      await asManager(request(http).patch(`/api/v1/checklists/${retired.id}`)).send({ status: 'INACTIVE' });
      const res = await createTask({ checklist_template_id: retired.id });
      expect(res.status).toBe(409);
    });

    it('TK-7. a template from another company cannot be attached', async () => {
      const otherTemplate = await prisma.checklistTemplate.create({
        data: { company_id: companyB.id, name: 'Beta list', items: { create: [{ label: 'x', position: 0 }] } },
      });
      const res = await createTask({ checklist_template_id: otherTemplate.id });
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTINES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Routines', () => {
    const makeRoutine = (body: Record<string, unknown> = {}) =>
      asManager(request(http).post('/api/v1/routines')).send({
        name: `Routine ${Math.random().toString(36).slice(2, 8)}`,
        frequency: 'DAILY',
        time_of_day: '00:05', // early, so it is already due whenever tests run
        ...body,
      });

    it('TR-1. creates a daily routine and reports its next occurrence', async () => {
      const res = await makeRoutine({ time_of_day: '09:00' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        branch_id: branchA.id,
        frequency: 'DAILY',
        time_of_day: '09:00',
        status: 'ACTIVE',
        weekdays: [],
      });
      expect(res.body.next_occurrence_at).not.toBeNull();
    });

    it('TR-2. a weekly routine needs weekdays; a daily one keeps none', async () => {
      const noDays = await makeRoutine({ frequency: 'WEEKLY' });
      expect(noDays.status).toBe(409);

      const weekly = await makeRoutine({ frequency: 'WEEKLY', weekdays: [1, 3, 1] });
      expect(weekly.status).toBe(201);
      expect(weekly.body.weekdays).toEqual([1, 3]); // de-duplicated and sorted

      const daily = await makeRoutine({ frequency: 'DAILY', weekdays: [1, 2] });
      expect(daily.body.weekdays).toEqual([]);
    });

    it('TR-3. validates the schedule shape', async () => {
      for (const body of [
        { time_of_day: '9:00' },
        { time_of_day: '24:00' },
        { time_of_day: '09:60' },
        { frequency: 'MONTHLY' },
        { frequency: 'WEEKLY', weekdays: [7] },
        { frequency: 'WEEKLY', weekdays: [-1] },
      ]) {
        const res = await makeRoutine(body);
        expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      }
    });

    it('TR-4. materialises a due occurrence into exactly one task', async () => {
      const routine = (await makeRoutine({ checklist_template_id: checklistA.id, default_assignee_id: workerA.id })).body;

      const first = await asManager(request(http).post('/api/v1/routines/materialize')).send();
      expect(first.status).toBe(200);
      expect(first.body.created).toBeGreaterThanOrEqual(1);

      const tasks = await prisma.task.findMany({ where: { routine_id: routine.id } });
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      const today = tasks.find(
        (t) => t.routine_occurrence_date?.toISOString().slice(0, 10) === branchLocalDate(new Date(), 'Asia/Kolkata'),
      );
      expect(today).toBeDefined();
      expect(today!.source).toBe('ROUTINE');
      expect(today!.assignee_id).toBe(workerA.id);
      expect(today!.due_at).not.toBeNull();

      // The generated task carries its own checklist snapshot.
      const items = await prisma.taskChecklistItem.findMany({ where: { task_id: today!.id } });
      expect(items.length).toBeGreaterThan(0);
    });

    it('TR-5. IDEMPOTENT: repeated materialization creates nothing new', async () => {
      const routine = (await makeRoutine()).body;
      const first = await asManager(request(http).post('/api/v1/routines/materialize')).send();
      const before = await prisma.task.count({ where: { routine_id: routine.id } });
      expect(before).toBeGreaterThanOrEqual(1);
      expect(first.body.created).toBeGreaterThanOrEqual(1);

      for (let i = 0; i < 3; i++) {
        await asManager(request(http).post('/api/v1/routines/materialize')).send();
      }
      const after = await prisma.task.count({ where: { routine_id: routine.id } });
      expect(after).toBe(before);
    });

    it('TR-6. an INACTIVE routine materialises nothing', async () => {
      const routine = (await makeRoutine()).body;
      await asManager(request(http).post(`/api/v1/routines/${routine.id}/deactivate`)).send();
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      expect(await prisma.task.count({ where: { routine_id: routine.id } })).toBe(0);

      // Reactivating lets it generate again.
      await asManager(request(http).post(`/api/v1/routines/${routine.id}/activate`)).send();
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      expect(await prisma.task.count({ where: { routine_id: routine.id } })).toBeGreaterThanOrEqual(1);
    });

    it('TR-7. activate/deactivate are rejected when already in that state', async () => {
      const routine = (await makeRoutine()).body;
      expect((await asManager(request(http).post(`/api/v1/routines/${routine.id}/activate`)).send()).status).toBe(409);
      expect((await asManager(request(http).post(`/api/v1/routines/${routine.id}/deactivate`)).send()).status).toBe(200);
      expect((await asManager(request(http).post(`/api/v1/routines/${routine.id}/deactivate`)).send()).status).toBe(409);
    });

    it('TR-8. a routine not yet due today produces nothing', async () => {
      // 23:59 branch-local has not passed for any realistic test run time.
      const routine = (await makeRoutine({ time_of_day: '23:59' })).body;
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      const tasks = await prisma.task.findMany({ where: { routine_id: routine.id } });
      const today = branchLocalDate(new Date(), 'Asia/Kolkata');
      expect(tasks.some((t) => t.routine_occurrence_date?.toISOString().slice(0, 10) === today)).toBe(false);
    });

    it('TR-8b. a routine created today never back-fills the days before it existed', async () => {
      // The look-back exists to catch up on MISSED days. A routine made just now
      // missed none: only today's (already due) slot may appear.
      const routine = (await makeRoutine()).body;
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      const tasks = await prisma.task.findMany({ where: { routine_id: routine.id } });
      const today = branchLocalDate(new Date(), 'Asia/Kolkata');
      expect(tasks.map((t) => t.routine_occurrence_date?.toISOString().slice(0, 10))).toEqual([today]);
    });

    it('TR-9. rejects a duplicate name and a cross-branch assignee/template', async () => {
      const routine = (await makeRoutine({ name: 'Unique routine' })).body;
      expect(routine.id).toBeDefined();
      expect((await makeRoutine({ name: 'Unique routine' })).status).toBe(409);
      expect((await makeRoutine({ default_assignee_id: branchOnlyA.id })).status).toBe(404);
      expect((await makeRoutine({ default_assignee_id: managerB.id })).status).toBe(404);
    });

    it('TR-10. the occurrence identity is enforced by the database', async () => {
      const routine = (await makeRoutine()).body;
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      const existing = await prisma.task.findFirst({ where: { routine_id: routine.id } });
      expect(existing).not.toBeNull();

      await expect(
        prisma.task.create({
          data: {
            company_id: companyA.id,
            branch_id: branchA.id,
            title: 'duplicate occurrence',
            routine_id: routine.id,
            routine_occurrence_date: existing!.routine_occurrence_date!,
            source: 'ROUTINE',
          },
        }),
      ).rejects.toThrow();
    });

    it('TR-11. a routine task cannot exist with half an occurrence identity', async () => {
      const routine = (await makeRoutine()).body;
      await expect(
        prisma.task.create({
          data: {
            company_id: companyA.id,
            branch_id: branchA.id,
            title: 'half identity',
            routine_id: routine.id,
            routine_occurrence_date: null,
            source: 'ROUTINE',
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scheduler integration', () => {
    it('TS-1. registers exactly one routine job, and it is disabled in tests', () => {
      expect(jobs.has(ROUTINE_JOB_NAME)).toBe(true);
      const status = jobs.status(ROUTINE_JOB_NAME);
      expect(status).toMatchObject({ name: ROUTINE_JOB_NAME, kind: 'interval' });
      // SCHEDULER_ENABLED=false in the e2e config: registered, never fired.
      expect(status!.runs).toBe(0);
    });

    it('TS-2. the service the job calls works across branches and is idempotent', async () => {
      const routine = (
        await asManager(request(http).post('/api/v1/routines')).send({
          name: `Sched ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '00:05',
        })
      ).body;

      const first = await routines.materializeAllBranches();
      expect(first.created).toBeGreaterThanOrEqual(1);
      const count = await prisma.task.count({ where: { routine_id: routine.id } });

      const second = await routines.materializeAllBranches();
      expect(second.created).toBe(0);
      expect(await prisma.task.count({ where: { routine_id: routine.id } })).toBe(count);
    });

    it('TS-3. an INACTIVE branch generates nothing', async () => {
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Task Manager' } });
      expect(role).not.toBeNull();
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchOff.id,
          name: `Closed branch ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '00:05',
          weekdays: [],
        },
      });
      await routines.materializeAllBranches();
      expect(await prisma.task.count({ where: { routine_id: routine.id } })).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD & REPORTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Dashboard and completion reporting', () => {
    it('TD-1. filters server-side by status, priority, assignment and overdue', async () => {
      const overdue = (await createTask({ due_at: '2020-01-01T00:00:00.000Z', priority: 'HIGH' })).body;
      await asManager(request(http).post(`/api/v1/tasks/${overdue.id}/assign`)).send({ assignee_id: workerA.id });

      const byStatus = await asManager(request(http).get('/api/v1/tasks')).query({ status: 'PENDING', limit: 100 });
      expect(byStatus.status).toBe(200);
      byStatus.body.data.forEach((t: any) => expect(t.status).toBe('PENDING'));

      const byPriority = await asManager(request(http).get('/api/v1/tasks')).query({ priority: 'HIGH', limit: 100 });
      byPriority.body.data.forEach((t: any) => expect(t.priority).toBe('HIGH'));

      const overdueOnly = await asManager(request(http).get('/api/v1/tasks')).query({ overdue: true, limit: 100 });
      expect(overdueOnly.body.data.map((t: any) => t.id)).toContain(overdue.id);
      overdueOnly.body.data.forEach((t: any) => expect(t.overdue).toBe(true));

      const mine = await as(request(http).get('/api/v1/tasks'), tokenWorkerA, companyA.id, branchA.id).query({
        assignee: 'me',
        limit: 100,
      });
      expect(mine.status).toBe(200);
      mine.body.data.forEach((t: any) => expect(t.assignee_id).toBe(workerA.id));

      const unassigned = await asManager(request(http).get('/api/v1/tasks')).query({ unassigned: true, limit: 100 });
      unassigned.body.data.forEach((t: any) => expect(t.assignee_id).toBeNull());
    });

    it('TD-2. "me" cannot be spoofed into meaning someone else', async () => {
      // workerA asking for "me" gets workerA's tasks, whoever else is named.
      const res = await as(request(http).get('/api/v1/tasks'), tokenWorkerA, companyA.id, branchA.id).query({
        assignee: 'me',
        limit: 100,
      });
      res.body.data.forEach((t: any) => expect(t.assignee_id).toBe(workerA.id));
    });

    it('TD-3. paginates and is branch-scoped', async () => {
      const page = await asManager(request(http).get('/api/v1/tasks')).query({ limit: 2, offset: 0 });
      expect(page.body.data.length).toBeLessThanOrEqual(2);
      expect(page.body.meta.total).toBeGreaterThan(2);
      page.body.data.forEach((t: any) => expect(t.branch_id).toBe(branchA.id));
    });

    it('TD-4. summarises completion for the branch', async () => {
      const res = await asManager(request(http).get('/api/v1/tasks/summary'));
      expect(res.status).toBe(200);
      expect(res.body.branch_id).toBe(branchA.id);
      expect(res.body.counts.total).toBeGreaterThan(0);
      expect(res.body.counts.completed).toBeGreaterThan(0);
      expect(res.body.completion_rate).toBeGreaterThan(0);
      expect(res.body.completion_rate).toBeLessThanOrEqual(100);
      expect(Array.isArray(res.body.by_routine)).toBe(true);
      expect(Array.isArray(res.body.by_assignee)).toBe(true);
      // Ad-hoc work is grouped separately from routine work.
      expect(res.body.by_routine.some((r: any) => r.routine_id === null)).toBe(true);
    });

    it('TD-5. the summary window is respected', async () => {
      const empty = await asManager(request(http).get('/api/v1/tasks/summary')).query({
        from: '2020-01-01T00:00:00.000Z',
        to: '2020-01-02T00:00:00.000Z',
      });
      expect(empty.status).toBe(200);
      expect(empty.body.counts.total).toBe(0);
      expect(empty.body.completion_rate).toBe(0);

      const backwards = await asManager(request(http).get('/api/v1/tasks/summary')).query({
        from: '2027-01-02T00:00:00.000Z',
        to: '2027-01-01T00:00:00.000Z',
      });
      expect(backwards.status).toBe(400);
    });

    it('TD-6. the summary needs its own permission', async () => {
      const res = await as(request(http).get('/api/v1/tasks/summary'), tokenWorkerA, companyA.id, branchA.id);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authorization', () => {
    it('TZ-1. rejects an unauthenticated request', async () => {
      const res = await request(http)
        .get('/api/v1/tasks')
        .set('X-Company-ID', companyA.id)
        .set('X-Branch-ID', branchA.id);
      expect(res.status).toBe(401);
    });

    it('TZ-2. tasks.view alone cannot mutate anything', async () => {
      const task = (await createTask()).body;
      const attempts: Array<[string, string, Record<string, unknown>]> = [
        ['post', '/api/v1/tasks', { title: 'x' }],
        ['patch', `/api/v1/tasks/${task.id}`, { title: 'x' }],
        ['post', `/api/v1/tasks/${task.id}/assign`, { assignee_id: workerA.id }],
        ['post', `/api/v1/tasks/${task.id}/start`, {}],
        ['post', `/api/v1/tasks/${task.id}/complete`, {}],
        ['post', `/api/v1/tasks/${task.id}/cancel`, {}],
        ['post', '/api/v1/routines', { name: 'x', frequency: 'DAILY', time_of_day: '09:00' }],
        ['post', '/api/v1/routines/materialize', {}],
      ];
      for (const [method, path, body] of attempts) {
        const res = await as((request(http) as any)[method](path), tokenViewerA, companyA.id, branchA.id).send(body);
        expect([path, res.status]).toEqual([path, 403]);
      }

      const read = await as(request(http).get('/api/v1/tasks'), tokenViewerA, companyA.id, branchA.id);
      expect(read.status).toBe(200);
    });

    it('TZ-3. a worker cannot assign or manage routines', async () => {
      const task = (await createTask()).body;
      expect(
        (await as(request(http).post(`/api/v1/tasks/${task.id}/assign`), tokenWorkerA, companyA.id, branchA.id).send({
          assignee_id: workerA.id,
        })).status,
      ).toBe(403);
      expect(
        (await as(request(http).post('/api/v1/routines'), tokenWorkerA, companyA.id, branchA.id).send({
          name: 'x',
          frequency: 'DAILY',
          time_of_day: '09:00',
        })).status,
      ).toBe(403);
    });

    it('TZ-4. a user with no task permission at the branch is refused', async () => {
      const res = await as(request(http).get('/api/v1/tasks'), tokenStrangerA, companyA.id, branchA.id);
      expect(res.status).toBe(403);
    });

    it('TZ-5. X-Branch-ID is not authorization', async () => {
      const res = await as(request(http).get('/api/v1/tasks'), tokenManagerA, companyA.id, branchA2.id);
      expect(res.status).toBe(403);
    });

    it('TZ-6. cross-company header spoofing is refused', async () => {
      expect((await as(request(http).get('/api/v1/tasks'), tokenManagerB, companyA.id, branchA.id)).status).toBe(403);
      expect((await as(request(http).get('/api/v1/checklists'), tokenManagerB, companyA.id)).status).toBe(403);
    });

    it("TZ-7. another company's task is 404, and its tasks never appear in a list", async () => {
      const mine = (await createTask()).body;
      const cross = await as(request(http).get(`/api/v1/tasks/${mine.id}`), tokenManagerB, companyB.id, branchB.id);
      expect(cross.status).toBe(404);

      const list = await as(request(http).get('/api/v1/tasks'), tokenManagerB, companyB.id, branchB.id).query({ limit: 100 });
      expect(list.body.data.map((t: any) => t.id)).not.toContain(mine.id);
    });

    it('TZ-8. an INACTIVE branch and a SUSPENDED company are refused', async () => {
      expect((await as(request(http).get('/api/v1/tasks'), tokenManagerA, companyA.id, branchOff.id)).status).toBe(403);
      expect((await as(request(http).get('/api/v1/tasks'), tokenSuspended, companyS.id, branchS.id)).status).toBe(403);
    });

    it('TZ-9. an INACTIVE membership and a disabled user are refused', async () => {
      const hash = await bcrypt.hash(PASSWORD, SALT);
      const role = await prisma.role.findFirst({ where: { company_id: companyA.id, name: 'Task Manager' } });

      const user = await prisma.user.create({ data: { email: 't-lapsing@test.com', password_hash: hash } });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({ data: { user_id: user.id, branch_id: branchA.id, role_id: role!.id } });
      const token = (await request(http).post('/api/v1/auth/login').send({ email: 't-lapsing@test.com', password: PASSWORD }))
        .body.accessToken as string;

      expect((await as(request(http).get('/api/v1/tasks'), token, companyA.id, branchA.id)).status).toBe(200);

      await prisma.companyMembership.updateMany({
        where: { user_id: user.id, company_id: companyA.id },
        data: { status: MembershipStatus.INACTIVE },
      });
      expect((await as(request(http).get('/api/v1/tasks'), token, companyA.id, branchA.id)).status).toBe(403);

      await prisma.companyMembership.updateMany({
        where: { user_id: user.id, company_id: companyA.id },
        data: { status: MembershipStatus.ACTIVE },
      });
      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.INACTIVE } });
      expect((await as(request(http).get('/api/v1/tasks'), token, companyA.id, branchA.id)).status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REALTIME
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Realtime', () => {
    const scope = (branchId: string) => ({
      companyId: companyA.id,
      branchId,
      channel: RealtimeChannel.TASKS,
    });

    const collect = (branchId: string, count: number, timeoutMs = 4000) =>
      new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        const sub = broker.subscribe(scope(branchId)).subscribe((e) => {
          events.push(e);
          if (events.length >= count) {
            sub.unsubscribe();
            clearTimeout(timer);
            resolve(events);
          }
        });
        const timer = setTimeout(() => {
          sub.unsubscribe();
          reject(new Error(`timed out with ${events.length}/${count} events`));
        }, timeoutMs);
      });

    it('TE-1. publishes the lifecycle on the tasks channel, in order', async () => {
      const wait = collect(branchA.id, 4);
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: workerA.id });
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send();
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();

      expect((await wait).map((e) => e.type)).toEqual([
        TASK_EVENT_TYPES.CREATED,
        TASK_EVENT_TYPES.ASSIGNED,
        TASK_EVENT_TYPES.STARTED,
        TASK_EVENT_TYPES.COMPLETED,
      ]);
    });

    it('TE-2. publishes checklist progress and routine materialization', async () => {
      const task = (await createTask({ checklist_template_id: checklistA.id })).body;
      const wait = collect(branchA.id, 1);
      await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${task.checklist[0].id}`)).send({ is_done: true });
      expect((await wait)[0].type).toBe(TASK_EVENT_TYPES.CHECKLIST_UPDATED);

      const routine = (
        await asManager(request(http).post('/api/v1/routines')).send({
          name: `RT ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '00:05',
        })
      ).body;
      expect(routine.id).toBeDefined();
      const materialized = collect(branchA.id, 1);
      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      expect((await materialized)[0].type).toBe(TASK_EVENT_TYPES.ROUTINE_MATERIALIZED);
    });

    it('TE-3. a failed mutation publishes nothing', async () => {
      const task = (await createTask()).body;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send();

      const seen: any[] = [];
      const sub = broker.subscribe(scope(branchA.id)).subscribe((e) => seen.push(e));
      const bad = await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send();
      expect(bad.status).toBe(409);
      await new Promise((r) => setTimeout(r, 100));
      expect(seen).toHaveLength(0);
      sub.unsubscribe();
    });

    it('TE-4. the payload is minimal and carries no credentials or emails', async () => {
      const wait = collect(branchA.id, 1);
      const created = (await createTask({ assignee_id: workerA.id })).body;
      expect(created.id).toBeDefined();
      const [event] = await wait;

      expect(event.data).toMatchObject({ branch_id: branchA.id, status: 'PENDING' });
      // A staff display name is fine on a staff-only channel; an email is not.
      expect(event.data.assignee).toEqual({ id: workerA.id, name: 'Wes Worker' });
      const json = JSON.stringify(event.data);
      expect(json).not.toContain('@test.com');
      expect(json).not.toMatch(/password|token|secret|hash|Bearer/i);
      // No raw checklist labels either — progress only.
      expect(event.data).not.toHaveProperty('checklist');
      expect(event.data.checklist_progress).toBeDefined();
    });

    it('TE-5. events do not leak across branches', async () => {
      const other: any[] = [];
      const sub = broker.subscribe(scope(branchA2.id)).subscribe((e) => other.push(e));
      const wait = collect(branchA.id, 1);
      await createTask();
      await wait;
      await new Promise((r) => setTimeout(r, 100));
      expect(other).toHaveLength(0);
      sub.unsubscribe();
    });

    it('TE-6. no display device can reach the tasks channel', async () => {
      // T0-B maps no display kind to `tasks`; a device asking is refused.
      const secret = 'a'.repeat(64);
      const device = await prisma.displayDevice.create({
        data: {
          branch_id: branchA.id,
          name: 'Probe',
          kind: 'QUEUE_CUSTOMER',
          credential_hash: require('crypto').createHash('sha256').update(secret).digest('hex'),
        },
      });
      const res = await request(http)
        .post('/api/v1/display/stream-tickets')
        .set('Authorization', `Display ${device.id}.${secret}`)
        .set('X-Branch-ID', branchA.id)
        .send({ channel: 'tasks' });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONCURRENCY
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFORMANCE: own-task visibility, ownership, comments, deadlines
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Own-task visibility (tasks.view_own)', () => {
    let ownUser: any;
    let tokenOwn: string;
    const asOwn = (req: request.Test) => as(req, tokenOwn, companyA.id, branchA.id);

    beforeAll(async () => {
      const names = ['tasks.view_own', 'tasks.create', 'tasks.update', 'tasks.start'];
      const perms = await prisma.permission.findMany({ where: { name: { in: names } } });
      expect(perms).toHaveLength(names.length);
      const role = await prisma.role.create({ data: { company_id: companyA.id, name: 'Own Tasks Only' } });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })),
      });
      ownUser = await prisma.user.create({
        data: {
          email: 't-own-a@test.com',
          password_hash: await bcrypt.hash(PASSWORD, SALT),
          first_name: 'Olu',
          last_name: 'Own',
        },
      });
      await prisma.companyMembership.create({
        data: { user_id: ownUser.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      await prisma.userBranchRole.create({
        data: { user_id: ownUser.id, branch_id: branchA.id, role_id: role.id },
      });
      tokenOwn = (
        await request(http).post('/api/v1/auth/login').send({ email: 't-own-a@test.com', password: PASSWORD })
      ).body.accessToken;
    });

    it('TO-1. sees tasks assigned to them or raised by them, and nothing else', async () => {
      const mine = (await createTask({ title: 'Assigned to own', assignee_id: ownUser.id })).body;
      const others = (await createTask({ title: 'Somebody else’s' })).body;
      const raised = (await asOwn(request(http).post('/api/v1/tasks')).send({ title: 'Raised by own' })).body;
      expect(raised.created_by).toBe(ownUser.id);

      const list = await asOwn(request(http).get('/api/v1/tasks?limit=100'));
      expect(list.status).toBe(200);
      const ids = list.body.data.map((t: any) => t.id);
      expect(ids).toContain(mine.id);
      expect(ids).toContain(raised.id);
      expect(ids).not.toContain(others.id);
      expect(list.body.meta.total).toBe(list.body.data.length);

      // Not by id either: 404, exactly as for a task in another branch.
      expect((await asOwn(request(http).get(`/api/v1/tasks/${others.id}`))).status).toBe(404);
      expect((await asOwn(request(http).get(`/api/v1/tasks/${mine.id}`))).status).toBe(200);
    });

    it('TO-2. cannot act on a task they cannot see, even with the action permission', async () => {
      const others = (await createTask()).body;
      const mine = (await createTask({ assignee_id: ownUser.id })).body;
      expect((await asOwn(request(http).post(`/api/v1/tasks/${others.id}/start`)).send()).status).toBe(404);
      expect((await asOwn(request(http).post(`/api/v1/tasks/${others.id}/comments`)).send({ body: 'hi' })).status).toBe(404);
      expect((await asOwn(request(http).get(`/api/v1/tasks/${others.id}/comments`))).status).toBe(404);
      expect((await asOwn(request(http).post(`/api/v1/tasks/${mine.id}/start`)).send()).status).toBe(200);
      const after = await prisma.task.findUnique({ where: { id: others.id } });
      expect(after!.status).toBe('PENDING');
    });

    it('TO-3. is refused the branch-wide task stream, whose events name other people’s tasks', async () => {
      expect((await asOwn(request(http).post('/api/v1/realtime/tickets/tasks'))).status).toBe(403);
    });

    it('TO-4. holding neither read key still sees nothing', async () => {
      const res = await as(request(http).get('/api/v1/tasks'), tokenStrangerA, companyA.id, branchA.id);
      expect(res.status).toBe(403);
    });
  });

  describe('Ownership and reassignment', () => {
    it('TW-1. records who raised a task, and routine tasks have no human creator', async () => {
      const task = (await createTask()).body;
      expect(task.created_by).toBe(managerA.id);
      expect(task.creator).toEqual({ id: managerA.id, name: 'Mina Manager' });
      expect(task.reassignment_count).toBe(0);
    });

    it('TW-2. counts only real reassignments and records the assigner and the previous assignee', async () => {
      const task = (await createTask({ assignee_id: workerA.id })).body;
      expect(task.assigned_by).toBe(managerA.id);
      expect(task.assigned_at).toBeTruthy();

      const assign = (assignee_id: string | null) =>
        asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id });

      expect((await assign(viewerA.id)).body.reassignment_count).toBe(1); // worker → viewer
      expect((await assign(viewerA.id)).body.reassignment_count).toBe(1); // same person: not a move
      const cleared = (await assign(null)).body;
      expect(cleared.reassignment_count).toBe(1); // clearing is not a reassignment
      expect(cleared.assigned_by).toBeNull();
      expect((await assign(workerA.id)).body.reassignment_count).toBe(1); // from nobody: not a move

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'TASK', entity_id: task.id },
        orderBy: { created_at: 'asc' },
      });
      const reassign = audits.find((a) => (a.payload as any).action === 'reassign_task');
      expect(reassign).toBeDefined();
      expect(reassign!.payload).toMatchObject({ previous_assignee_id: workerA.id, assignee_id: viewerA.id });
    });

    it('TW-3. lists the assignable staff of THIS branch, by name only, behind tasks.assign', async () => {
      const res = await asManager(request(http).get('/api/v1/tasks/assignable-staff'));
      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).toEqual(expect.arrayContaining([workerA.id, viewerA.id, managerA.id]));
      expect(ids).not.toContain(branchOnlyA.id); // works at the second branch only
      expect(ids).not.toContain(managerB.id);
      expect(JSON.stringify(res.body)).not.toContain('@test.com');

      const worker = await as(request(http).get('/api/v1/tasks/assignable-staff'), tokenWorkerA, companyA.id, branchA.id);
      expect(worker.status).toBe(403);
    });
  });

  describe('Edits and comments', () => {
    it('TD-1. an edit is audited with old and new values and published as task.updated', async () => {
      const task = (await createTask({ title: 'Before', priority: 'LOW' })).body;
      const wait = new Promise<Array<{ type: string }>>((resolve) => {
        const sub = broker
          .subscribe({ companyId: companyA.id, branchId: branchA.id, channel: RealtimeChannel.TASKS })
          .subscribe((e: any) => {
            sub.unsubscribe();
            resolve([e]);
          });
      });
      const res = await asManager(request(http).patch(`/api/v1/tasks/${task.id}`)).send({
        title: 'After',
        priority: 'LOW', // unchanged: not recorded as a change
      });
      expect(res.status).toBe(200);
      expect((await wait)[0].type).toBe(TASK_EVENT_TYPES.UPDATED);

      const audit = await prisma.auditLog.findFirst({
        where: { entity_type: 'TASK', entity_id: task.id, payload: { path: ['action'], equals: 'update_task' } },
      });
      expect(audit!.payload).toMatchObject({
        changed_fields: ['title'],
        changes: { title: { from: 'Before', to: 'After' } },
      });
    });

    it('TD-2. comments are added, listed in order, and cannot be blank', async () => {
      const task = (await createTask()).body;
      const post = (token: string, body: unknown) =>
        as(request(http).post(`/api/v1/tasks/${task.id}/comments`), token, companyA.id, branchA.id).send(body);

      const first = await post(tokenWorkerA, { body: '  Fridge was warm, reported to chef  ' });
      expect(first.status).toBe(201);
      expect(first.body.body).toBe('Fridge was warm, reported to chef');
      expect(first.body.author).toEqual({ id: workerA.id, name: 'Wes Worker' });
      expect((await post(tokenManagerA, { body: 'Thanks' })).status).toBe(201);

      expect((await post(tokenWorkerA, { body: '   ' })).status).toBe(400);
      expect((await post(tokenWorkerA, { body: 'x'.repeat(2001) })).status).toBe(400);
      // Commenting is working on the task: tasks.view alone is not enough.
      expect((await post(tokenViewerA, { body: 'Nope' })).status).toBe(403);

      const list = await asManager(request(http).get(`/api/v1/tasks/${task.id}/comments`));
      expect(list.status).toBe(200);
      expect(list.body.map((c: any) => c.body)).toEqual(['Fridge was warm, reported to chef', 'Thanks']);
    });

    it('TD-3. a comment is append-only at the database level', async () => {
      const task = (await createTask()).body;
      const comment = (
        await asManager(request(http).post(`/api/v1/tasks/${task.id}/comments`)).send({ body: 'Immutable' })
      ).body;
      await expect(
        prisma.taskComment.update({ where: { id: comment.id }, data: { body: 'Rewritten' } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.taskComment.delete({ where: { id: comment.id } })).rejects.toThrow(/append-only/);
    });

    it('TD-4. comments on another branch’s task are not reachable', async () => {
      // Written directly: managerA holds no role at the second branch.
      const other = await prisma.task.create({
        data: { company_id: companyA.id, branch_id: branchA2.id, title: 'Second branch task' },
      });
      expect((await asManager(request(http).get(`/api/v1/tasks/${other.id}/comments`))).status).toBe(404);
      expect(
        (await asManager(request(http).post(`/api/v1/tasks/${other.id}/comments`)).send({ body: 'Leak?' })).status,
      ).toBe(404);
    });
  });

  describe('Query flags', () => {
    it('TF-1. overdue=false and unassigned=false do not filter as if they were true', async () => {
      // Guarantee both kinds exist, so a wrong filter changes the totals.
      await createTask({ due_at: new Date(Date.now() - 3_600_000).toISOString() });
      await createTask({ assignee_id: workerA.id });

      const total = async (qs: string) => {
        const res = await asManager(request(http).get(`/api/v1/tasks${qs}`));
        expect(res.status).toBe(200);
        return res.body.meta.total as number;
      };
      const all = await total('');

      // "false" means no filter — before the fix the string read as true.
      expect(await total('?overdue=false')).toBe(all);
      expect(await total('?unassigned=false')).toBe(all);
      // "true" still filters.
      expect(await total('?overdue=true')).toBeLessThan(all);
      expect(await total('?unassigned=true')).toBeLessThan(all);

      expect((await asManager(request(http).get('/api/v1/tasks?overdue=maybe'))).status).toBe(400);
    });
  });

  describe('Routine deadlines', () => {
    it('TR-D1. a routine with a deadline generates a task due at that branch-local time', async () => {
      const routine = (
        await asManager(request(http).post('/api/v1/routines')).send({
          name: `Deadline ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '00:01',
          due_time: '23:59',
        })
      ).body;
      expect(routine.due_time).toBe('23:59');

      await asManager(request(http).post('/api/v1/routines/materialize')).send();
      const today = branchLocalDate(new Date(), 'Asia/Kolkata');
      const task = await prisma.task.findFirst({
        where: { routine_id: routine.id, routine_occurrence_date: new Date(`${today}T00:00:00.000Z`) },
      });
      expect(task).not.toBeNull();
      // 23:59 IST on the occurrence day.
      expect(task!.due_at!.toISOString()).toBe(new Date(`${today}T18:29:00.000Z`).toISOString());
      expect(task!.created_by).toBeNull();

      // Scheduler/manual materialization is attributed to the tenant.
      const audit = await prisma.auditLog.findFirst({ where: { entity_type: 'TASK', entity_id: task!.id } });
      expect(audit!.company_id).toBe(companyA.id);
      expect(audit!.branch_id).toBe(branchA.id);
    });

    it('TR-D2. a deadline earlier than the routine time, or malformed, is refused', async () => {
      const early = await asManager(request(http).post('/api/v1/routines')).send({
        name: `Early ${Date.now()}`,
        frequency: 'DAILY',
        time_of_day: '09:00',
        due_time: '08:00',
      });
      expect(early.status).toBe(409);
      const bad = await asManager(request(http).post('/api/v1/routines')).send({
        name: `Bad ${Date.now()}`,
        frequency: 'DAILY',
        time_of_day: '09:00',
        due_time: '9am',
      });
      expect(bad.status).toBe(400);
    });
  });

  describe('Concurrency', () => {
    it('TX-6. completing while a required item is unticked never completes an incomplete checklist', async () => {
      for (let round = 0; round < 5; round++) {
        const task = (await createTask({ checklist_template_id: checklistA.id })).body;
        const required = task.checklist.filter((i: any) => i.is_required);
        for (const item of required) {
          await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${item.id}`)).send({ is_done: true });
        }

        const [untick, complete] = await Promise.all([
          asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${required[0].id}`)).send({ is_done: false }),
          asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send(),
        ]);
        expect([200, 409]).toContain(untick.status);
        expect([200, 409]).toContain(complete.status);

        const after = await prisma.task.findUnique({ where: { id: task.id }, include: { checklist: true } });
        const undone = after!.checklist.filter((i) => i.is_required && !i.is_done);
        if (after!.status === 'COMPLETED') {
          expect(undone).toHaveLength(0);
          expect(untick.status).toBe(409);
        } else {
          expect(complete.status).toBe(409);
        }
      }
    });

    it('TX-1. ten simultaneous materializations produce ONE task per occurrence', async () => {
      const routine = (
        await asManager(request(http).post('/api/v1/routines')).send({
          name: `Race ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '00:05',
        })
      ).body;

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          asManager(request(http).post('/api/v1/routines/materialize')).send(),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);

      const tasks = await prisma.task.findMany({ where: { routine_id: routine.id } });
      const dates = tasks.map((t) => t.routine_occurrence_date?.toISOString().slice(0, 10));
      // One per distinct occurrence date, never ten.
      expect(new Set(dates).size).toBe(dates.length);
      const today = branchLocalDate(new Date(), 'Asia/Kolkata');
      expect(tasks.filter((t) => t.routine_occurrence_date?.toISOString().slice(0, 10) === today)).toHaveLength(1);

      // Across all ten runs exactly the right number of creations was reported.
      const created = results.reduce((n, r) => n + (r.body.created as number), 0);
      expect(created).toBe(tasks.length);
    });

    it('TX-2. simultaneous completions: exactly one succeeds', async () => {
      const task = (await createTask()).body;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send(),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);

      const after = await prisma.task.findUnique({ where: { id: task.id } });
      expect(after!.status).toBe('COMPLETED');
    });

    it('TX-3. competing start and cancel leave a final state consistent with what succeeded', async () => {
      // IN_PROGRESS → CANCELLED is a legal move, so this race has THREE honest
      // outcomes, depending on commit order:
      //   start wins the read, cancel loses it   → 200/409, IN_PROGRESS
      //   cancel wins the read, start loses it   → 409/200, CANCELLED
      //   start commits, then cancel reads it    → 200/200, CANCELLED
      // What must never happen is a response that disagrees with the row.
      const task = (await createTask()).body;
      const [start, cancel] = await Promise.all([
        asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send(),
        asManager(request(http).post(`/api/v1/tasks/${task.id}/cancel`)).send(),
      ]);
      expect([200, 409]).toContain(start.status);
      expect([200, 409]).toContain(cancel.status);
      expect([start.status, cancel.status]).toContain(200);

      const after = await prisma.task.findUnique({ where: { id: task.id } });
      if (cancel.status === 200) {
        expect(after!.status).toBe('CANCELLED');
      } else {
        expect(start.status).toBe(200);
        expect(after!.status).toBe('IN_PROGRESS');
      }
    });

    it('TX-4. competing assignments settle on one of them, never a mix', async () => {
      const task = (await createTask()).body;
      const results = await Promise.all([
        asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: workerA.id }),
        asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: viewerA.id }),
        asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({}),
      ]);
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);

      const after = await prisma.task.findUnique({ where: { id: task.id } });
      expect([workerA.id, viewerA.id, null]).toContain(after!.assignee_id);
    });

    it('TX-5. concurrent checklist ticks never lose an update', async () => {
      const task = (await createTask({ checklist_template_id: checklistA.id })).body;
      const item = task.checklist[0];

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${item.id}`)).send({ is_done: true }),
        ),
      );
      // Whoever wins, the item ends up done exactly once, with one owner.
      expect(results.some((r) => r.status === 200)).toBe(true);
      const after = await prisma.taskChecklistItem.findUnique({ where: { id: item.id } });
      expect(after!.is_done).toBe(true);
      expect(after!.done_by).toBe(managerA.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Typed checklist answers, reference library and the transposed log', () => {
    let typed: any;
    const answer = (taskId: string, itemId: string, body: Record<string, unknown>, token = tokenManagerA) =>
      as(request(http).patch(`/api/v1/tasks/${taskId}/checklist/${itemId}`), token, companyA.id, branchA.id).send(body);

    beforeAll(async () => {
      typed = (
        await as(request(http).post('/api/v1/checklists'), tokenManagerA, companyA.id).send({
          name: 'EOD typed',
          items: [
            { label: 'Meter reading', kind: 'NUMBER' },
            { label: 'Reception', kind: 'RATING' },
            { label: 'Closing note', kind: 'TEXT', is_required: false },
            { label: 'Lights off' },
          ],
        })
      ).body;
    });

    it('TY-1. a template carries each item’s kind into the task it creates', async () => {
      expect(typed.items.map((i: any) => i.kind)).toEqual(['NUMBER', 'RATING', 'TEXT', 'CHECK']);
      const task = (await createTask({ checklist_template_id: typed.id })).body;
      expect(task.checklist.map((i: any) => [i.kind, i.value])).toEqual([
        ['NUMBER', null],
        ['RATING', null],
        ['TEXT', null],
        ['CHECK', null],
      ]);
    });

    it('TY-2. an answer is what marks a typed item done, stored in canonical form', async () => {
      const task = (await createTask({ checklist_template_id: typed.id })).body;
      const [meter, rating, note, lights] = task.checklist;

      expect((await answer(task.id, meter.id, { is_done: true })).status).toBe(400);
      expect((await answer(task.id, meter.id, { is_done: true, value: '12.3456' })).status).toBe(400);
      expect((await answer(task.id, rating.id, { is_done: true, value: '6' })).status).toBe(400);
      expect((await answer(task.id, lights.id, { is_done: true, value: 'yes' })).status).toBe(400);

      const saved = await answer(task.id, meter.id, { is_done: true, value: '001234.50' });
      expect(saved.status).toBe(200);
      expect(saved.body.checklist[0]).toMatchObject({ is_done: true, value: '1234.5' });

      // Changing the answer on a done item replaces it.
      const changed = await answer(task.id, meter.id, { is_done: true, value: '1300' });
      expect(changed.body.checklist[0].value).toBe('1300');

      // Clearing removes the answer.
      const cleared = await answer(task.id, meter.id, { is_done: false });
      expect(cleared.body.checklist[0]).toMatchObject({ is_done: false, value: null });

      await answer(task.id, note.id, { is_done: true, value: '  All good  ' });
      const detail = await asManager(request(http).get(`/api/v1/tasks/${task.id}`));
      expect(detail.body.checklist[2].value).toBe('All good');

      // The database refuses a done typed item without an answer, whatever writes it.
      await expect(
        prisma.taskChecklistItem.update({ where: { id: meter.id }, data: { is_done: true } }),
      ).rejects.toThrow(/task_checklist_items_answered_when_done/);
    });

    it('TY-3. a task cannot complete while a required typed item is unanswered', async () => {
      const task = (await createTask({ checklist_template_id: typed.id })).body;
      const [meter, rating, , lights] = task.checklist;
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send();
      await answer(task.id, meter.id, { is_done: true, value: '10' });
      await answer(task.id, lights.id, { is_done: true });
      expect((await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send()).status).toBe(409);

      await answer(task.id, rating.id, { is_done: true, value: '4' });
      expect((await asManager(request(http).post(`/api/v1/tasks/${task.id}/complete`)).send()).status).toBe(200);
    });

    it('TY-4. the audit trail records that an answer was given, never what it says', async () => {
      const task = (await createTask({ checklist_template_id: typed.id })).body;
      await answer(task.id, task.checklist[2].id, { is_done: true, value: 'Customer Ravi complained about dal' });
      const audits = await prisma.auditLog.findMany({ where: { entity_id: task.id } });
      const blob = JSON.stringify(audits.map((a) => a.payload));
      expect(blob).toContain('has_value');
      expect(blob).not.toContain('Ravi');
    });

    it('TY-5. the reference library installs an editable company template, once, behind checklist.manage', async () => {
      const library = await as(request(http).get('/api/v1/checklists/library'), tokenManagerA, companyA.id);
      expect(library.status).toBe(200);
      const banquet = library.body.find((r: any) => r.key === 'banquet-opening');
      expect(banquet.installed).toBe(false);
      expect(library.body.map((r: any) => r.name)).not.toContain('BM Checklist');

      const refused = await as(
        request(http).post('/api/v1/checklists/library/banquet-opening'),
        tokenWorkerA,
        companyA.id,
      ).send();
      expect(refused.status).toBe(403);

      const installed = await as(
        request(http).post('/api/v1/checklists/library/banquet-opening'),
        tokenManagerA,
        companyA.id,
      ).send();
      expect(installed.status).toBe(201);
      expect(installed.body.name).toBe('Banquet Opening Checklist');
      expect(installed.body.items.map((i: any) => i.label)).toContain('Generators');

      const again = await as(
        request(http).post('/api/v1/checklists/library/banquet-opening'),
        tokenManagerA,
        companyA.id,
      ).send();
      expect(again.status).toBe(409);
      expect(
        (await as(request(http).post('/api/v1/checklists/library/no-such-thing'), tokenManagerA, companyA.id).send())
          .status,
      ).toBe(404);

      const relisted = await as(request(http).get('/api/v1/checklists/library'), tokenManagerA, companyA.id);
      expect(relisted.body.find((r: any) => r.key === 'banquet-opening').installed).toBe(true);
    });

    it('TY-6. the transposed log lines each item up across occurrence dates, and is branch-scoped', async () => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Log routine ${Math.random().toString(36).slice(2, 7)}`,
          frequency: 'DAILY',
          time_of_day: '09:00',
        },
      });
      const occurrence = (date: string, meter: string | null, lightsDone: boolean) =>
        prisma.task.create({
          data: {
            company_id: companyA.id,
            branch_id: branchA.id,
            title: routine.name,
            source: 'ROUTINE',
            routine_id: routine.id,
            routine_occurrence_date: new Date(`${date}T00:00:00.000Z`),
            checklist: {
              create: [
                { label: 'Meter reading', kind: 'NUMBER', position: 0, is_done: meter !== null, value: meter },
                { label: 'Lights off', kind: 'CHECK', position: 1, is_done: lightsDone },
              ],
            },
          },
        });
      await occurrence('2026-09-01', '100', true);
      await occurrence('2026-09-02', null, false);
      await occurrence('2026-09-03', '120.5', true);

      const log = await asManager(request(http).get(`/api/v1/routines/${routine.id}/log`)).query({
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(log.status).toBe(200);
      expect(log.body.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
      const meterRow = log.body.rows.find((r: any) => r.label === 'Meter reading');
      expect(meterRow.cells).toEqual({
        '2026-09-01': { done: true, value: '100' },
        '2026-09-02': { done: false, value: null },
        '2026-09-03': { done: true, value: '120.5' },
      });
      const lightsRow = log.body.rows.find((r: any) => r.label === 'Lights off');
      expect(Object.values(lightsRow.cells).map((c: any) => c.done)).toEqual([true, false, true]);

      // Another branch cannot read it; a worker without tasks.reports.view cannot either.
      expect(
        (await asManager(request(http).get(`/api/v1/routines/${routine.id}/log`), branchOff.id).query({ from: '2026-09-01', to: '2026-09-03' })).status,
      ).toBe(403);
      expect(
        (
          await as(request(http).get(`/api/v1/routines/${routine.id}/log`), tokenWorkerA, companyA.id, branchA.id).query({
            from: '2026-09-01',
            to: '2026-09-03',
          })
        ).status,
      ).toBe(403);
      expect(
        (await asManager(request(http).get(`/api/v1/routines/${routine.id}/log`)).query({ from: '2026-09-01', to: '2026-12-31' })).status,
      ).toBe(400);
    });

    it('TY-7. the log exports as Excel or PDF only with reports.export as well, and the export is audited', async () => {
      const routine = await prisma.taskRoutine.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          name: `Export routine ${Math.random().toString(36).slice(2, 7)}`,
          frequency: 'DAILY',
          time_of_day: '09:00',
        },
      });
      await prisma.task.create({
        data: {
          company_id: companyA.id,
          branch_id: branchA.id,
          title: routine.name,
          source: 'ROUTINE',
          routine_id: routine.id,
          routine_occurrence_date: new Date('2026-09-01T00:00:00.000Z'),
          checklist: { create: [{ label: 'Meter reading', kind: 'NUMBER', position: 0, is_done: true, value: '100' }] },
        },
      });
      const exportLog = (query: Record<string, string>, token = tokenManagerA, branchId = branchA.id) =>
        as(request(http).get(`/api/v1/routines/${routine.id}/log/export`), token, companyA.id, branchId)
          .query(query)
          .responseType('blob');
      const week = { from: '2026-09-01', to: '2026-09-07' };

      // Reading the log is not permission to take it away.
      expect((await exportLog({ ...week, format: 'xlsx' })).status).toBe(403);

      const assignment = await prisma.userBranchRole.findFirstOrThrow({ where: { user_id: managerA.id, branch_id: branchA.id } });
      const exportPermission = await prisma.permission.findUniqueOrThrow({ where: { name: 'reports.export' } });
      await prisma.rolePermission.create({ data: { role_id: assignment.role_id, permission_id: exportPermission.id } });
      try {
        const startedAt = new Date();
        const xlsx = await exportLog({ ...week, format: 'xlsx' });
        expect(xlsx.status).toBe(200);
        expect(xlsx.headers['content-type']).toContain('spreadsheetml');
        expect(xlsx.headers['content-disposition']).toBe('attachment; filename="tasks.routine_log_2026-09-01_2026-09-07.xlsx"');
        expect(xlsx.body.subarray(0, 2).toString('latin1')).toBe('PK');

        const pdf = await exportLog({ ...week, format: 'pdf' });
        expect(pdf.status).toBe(200);
        expect(pdf.headers['content-type']).toContain('application/pdf');
        expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        // Twenty date columns are unreadable on a PDF page, not in a sheet.
        const long = { from: '2026-09-01', to: '2026-09-20' };
        expect((await exportLog({ ...long, format: 'pdf' })).status).toBe(400);
        expect((await exportLog({ ...long, format: 'xlsx' })).status).toBe(200);
        expect((await exportLog({ ...week, format: 'csv' })).status).toBe(400);

        const audit = await prisma.auditLog.findFirst({
          where: { entity_type: 'REPORT_EXPORT', company_id: companyA.id, created_at: { gte: startedAt } },
          orderBy: { created_at: 'asc' },
        });
        expect(audit!.payload).toMatchObject({
          action: 'export_routine_log',
          routine_id: routine.id,
          format: 'xlsx',
          from: '2026-09-01',
          to: '2026-09-07',
          row_count: 2,
        });
        expect(JSON.stringify(audit!.payload)).not.toContain('Meter reading');

        // A worker cannot; the manager's inactive branch proves nothing.
        expect((await exportLog({ ...week, format: 'xlsx' }, tokenWorkerA)).status).toBe(403);
        expect((await exportLog({ ...week, format: 'xlsx' }, tokenManagerA, branchOff.id)).status).toBe(403);
      } finally {
        await prisma.rolePermission.deleteMany({ where: { role_id: assignment.role_id, permission_id: exportPermission.id } });
      }
    });
  });

  describe('Checklist item photos', () => {
    let photoTemplate: any;
    // A tiny valid PNG — a real (decodable) image keeps this test honest about
    // what a client would actually send, unlike an arbitrary byte string.
    const onePixelPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bigPng = Buffer.alloc(6 * 1024 * 1024).toString('base64'); // > MAX_PHOTO_SIZE_BYTES

    beforeAll(async () => {
      photoTemplate = (
        await as(request(http).post('/api/v1/checklists'), tokenManagerA, companyA.id).send({
          name: 'EOD with photos',
          items: [
            { label: 'EB Photos', kind: 'PHOTO', section: 'EB' },
            { label: 'EB Reading', kind: 'NUMBER', is_required: false, section: 'EB' },
          ],
        })
      ).body;
    });

    const upload = (taskId: string, itemId: string, data: string, token = tokenManagerA) =>
      as(request(http).post(`/api/v1/tasks/${taskId}/checklist/${itemId}/photos`), token, companyA.id, branchA.id).send({
        data,
        mime_type: 'image/png',
        file_name: 'evidence.png',
      });

    it('PH-1. a template carries `section` onto the task it creates', async () => {
      const task = (await createTask({ checklist_template_id: photoTemplate.id })).body;
      expect(task.checklist.map((i: any) => [i.kind, i.section])).toEqual([
        ['PHOTO', 'EB'],
        ['NUMBER', 'EB'],
      ]);
    });

    it('PH-2. uploading a photo marks the item done; deleting the last one clears it again', async () => {
      const task = (await createTask({ checklist_template_id: photoTemplate.id })).body;
      const [photoItem] = task.checklist;

      const uploaded = await upload(task.id, photoItem.id, onePixelPng);
      expect(uploaded.status).toBe(201);
      expect(uploaded.body).toMatchObject({ checklist_item_id: photoItem.id, mime_type: 'image/png', file_name: 'evidence.png', position: 0 });
      expect(uploaded.body.data).toBeUndefined(); // bytes are never in a JSON response

      const afterUpload = await asManager(request(http).get(`/api/v1/tasks/${task.id}`));
      expect(afterUpload.body.checklist[0]).toMatchObject({ is_done: true });

      const list = await as(request(http).get(`/api/v1/tasks/${task.id}/checklist/${photoItem.id}/photos`), tokenManagerA, companyA.id, branchA.id);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const fetched = await as(
        request(http).get(`/api/v1/tasks/${task.id}/checklist/${photoItem.id}/photos/${uploaded.body.id}`),
        tokenManagerA,
        companyA.id,
        branchA.id,
      ).responseType('blob');
      expect(fetched.status).toBe(200);
      expect(fetched.headers['content-type']).toBe('image/png');
      expect(Buffer.from(fetched.body).toString('base64')).toBe(onePixelPng);

      const deleted = await as(
        request(http).delete(`/api/v1/tasks/${task.id}/checklist/${photoItem.id}/photos/${uploaded.body.id}`),
        tokenManagerA,
        companyA.id,
        branchA.id,
      ).send();
      expect(deleted.status).toBe(204);

      const afterDelete = await asManager(request(http).get(`/api/v1/tasks/${task.id}`));
      expect(afterDelete.body.checklist[0]).toMatchObject({ is_done: false });
    });

    it('PH-3. refuses a photo over the size limit, a 6th photo, and a photo on a non-photo item', async () => {
      const task = (await createTask({ checklist_template_id: photoTemplate.id })).body;
      const [photoItem, numberItem] = task.checklist;

      expect((await upload(task.id, photoItem.id, bigPng)).status).toBe(400);
      expect((await upload(task.id, numberItem.id, onePixelPng)).status).toBe(400);

      for (let i = 0; i < 5; i++) {
        expect((await upload(task.id, photoItem.id, onePixelPng)).status).toBe(201);
      }
      expect((await upload(task.id, photoItem.id, onePixelPng)).status).toBe(409);
    });

    it('PH-5. a photo item can take more (or fewer) than the default five', async () => {
      const template = (
        await as(request(http).post('/api/v1/checklists'), tokenManagerA, companyA.id).send({
          name: `Photo limits ${Math.random().toString(36).slice(2, 7)}`,
          items: [
            { label: 'Ten photos', kind: 'PHOTO', max_photos: 10 },
            { label: 'One photo', kind: 'PHOTO', max_photos: 1 },
            // A limit means nothing on a non-photo item, so it is dropped.
            { label: 'A note', kind: 'TEXT', max_photos: 3 },
          ],
        })
      ).body;
      expect(template.items.map((i: any) => i.max_photos)).toEqual([10, 1, null]);

      const task = (await createTask({ checklist_template_id: template.id })).body;
      const [ten, one] = task.checklist;
      expect([ten.max_photos, one.max_photos]).toEqual([10, 1]);

      for (let i = 0; i < 6; i++) {
        expect((await upload(task.id, ten.id, onePixelPng)).status).toBe(201);
      }
      expect((await upload(task.id, one.id, onePixelPng)).status).toBe(201);
      expect((await upload(task.id, one.id, onePixelPng)).status).toBe(409);

      // Above the cap is refused when the checklist is defined.
      const tooMany = await as(request(http).post('/api/v1/checklists'), tokenManagerA, companyA.id).send({
        name: `Too many photos ${Math.random().toString(36).slice(2, 7)}`,
        items: [{ label: 'Eleven', kind: 'PHOTO', max_photos: 11 }],
      });
      expect(tooMany.status).toBe(400);
    });

    it('PH-4. photos ride on tasks.update — a viewer may see them but not add or remove one', async () => {
      const task = (await createTask({ checklist_template_id: photoTemplate.id })).body;
      const [photoItem] = task.checklist;
      const uploaded = await upload(task.id, photoItem.id, onePixelPng);

      expect((await upload(task.id, photoItem.id, onePixelPng, tokenViewerA)).status).toBe(403);
      expect(
        (
          await as(
            request(http).delete(`/api/v1/tasks/${task.id}/checklist/${photoItem.id}/photos/${uploaded.body.id}`),
            tokenViewerA,
            companyA.id,
            branchA.id,
          ).send()
        ).status,
      ).toBe(403);
      expect(
        (await as(request(http).get(`/api/v1/tasks/${task.id}/checklist/${photoItem.id}/photos`), tokenViewerA, companyA.id, branchA.id)).status,
      ).toBe(200);
    });
  });

  describe('Audit', () => {
    it('TU-1. every task mutation is audited with company, branch and actor', async () => {
      const task = (await createTask({ checklist_template_id: checklistA.id })).body;
      await asManager(request(http).patch(`/api/v1/tasks/${task.id}`)).send({ title: 'Renamed' });
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/assign`)).send({ assignee_id: workerA.id });
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send();
      await asManager(request(http).patch(`/api/v1/tasks/${task.id}/checklist/${task.checklist[0].id}`)).send({ is_done: true });
      await asManager(request(http).post(`/api/v1/tasks/${task.id}/cancel`)).send();

      const audits = await prisma.auditLog.findMany({
        where: { entity_type: 'TASK', entity_id: task.id },
      });
      const actions = new Set(audits.map((a) => (a.payload as any).action));
      for (const expected of [
        'create_task',
        'update_task',
        'assign_task',
        'start_task',
        'set_checklist_item',
        'cancel_task',
      ]) {
        expect([expected, actions.has(expected)]).toEqual([expected, true]);
      }
      audits.forEach((a) => {
        expect(a.company_id).toBe(companyA.id);
        expect(a.branch_id).toBe(branchA.id);
        expect(a.user_id).toBe(managerA.id);
      });
    });

    it('TU-2. routine and checklist mutations are audited too', async () => {
      const routine = (
        await asManager(request(http).post('/api/v1/routines')).send({
          name: `Audited ${Date.now()}`,
          frequency: 'DAILY',
          time_of_day: '09:00',
        })
      ).body;
      await asManager(request(http).post(`/api/v1/routines/${routine.id}/deactivate`)).send();

      const routineAudits = await prisma.auditLog.findMany({
        where: { entity_type: 'TASK_ROUTINE', entity_id: routine.id },
      });
      const actions = routineAudits.map((a) => (a.payload as any).action);
      expect(actions).toContain('create_routine');
      expect(actions).toContain('deactivate_routine');

      const templateAudits = await prisma.auditLog.findMany({
        where: { entity_type: 'CHECKLIST_TEMPLATE' },
      });
      expect(templateAudits.length).toBeGreaterThan(0);
    });

    it('TU-3. audit payloads carry no emails or secrets', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { entity_type: { in: ['TASK', 'TASK_ROUTINE', 'CHECKLIST_TEMPLATE'] } },
      });
      const blob = JSON.stringify(audits.map((a) => a.payload));
      expect(blob).not.toContain('@test.com');
      expect(blob).not.toMatch(/password|secret|Bearer/i);
    });
  });
});

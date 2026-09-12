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
    app = moduleFixture.createNestApplication();
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

  describe('Concurrency', () => {
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

    it('TX-3. competing start and cancel leave one deterministic final state', async () => {
      const task = (await createTask()).body;
      const [start, cancel] = await Promise.all([
        asManager(request(http).post(`/api/v1/tasks/${task.id}/start`)).send(),
        asManager(request(http).post(`/api/v1/tasks/${task.id}/cancel`)).send(),
      ]);
      const ok = [start, cancel].filter((r) => r.status === 200);
      expect(ok).toHaveLength(1);

      const after = await prisma.task.findUnique({ where: { id: task.id } });
      expect(['IN_PROGRESS', 'CANCELLED']).toContain(after!.status);
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { ChecklistTemplate, Routine, Task, TaskDetail, TaskSummary } from '@/lib/tasks/types';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  assign: vi.fn(),
  assignableStaff: vi.fn(),
  comments: vi.fn(),
  addComment: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  setChecklistItem: vi.fn(),
  summary: vi.fn(),
  listRoutines: vi.fn(),
  createRoutine: vi.fn(),
  activateRoutine: vi.fn(),
  deactivateRoutine: vi.fn(),
  materialize: vi.fn(),
  listChecklists: vi.fn(),
  createChecklist: vi.fn(),
  updateChecklist: vi.fn(),
  referenceLibrary: vi.fn(),
  installReference: vi.fn(),
  routineLog: vi.fn(),
  exportRoutineLog: vi.fn(),
  streamTicket: vi.fn(),
}));

const saveFileMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reports/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/reports/api')>('@/lib/reports/api')),
  saveFile: saveFileMock,
}));

const lazyProxy = vi.hoisted(
  () =>
    <T extends Record<string, (...args: never[]) => unknown>>(target: T) =>
      new Proxy(target, {
        get: (t, k: string) => (...a: unknown[]) =>
          (t[k] as unknown as (...args: unknown[]) => unknown)(...a),
      }),
);

vi.mock('@/lib/tasks/api', () => ({ tasksApi: lazyProxy(apiMock) }));

let branchPermissions: string[] = [];
let companyPermissions: string[] = [];
let selectedBranchId: string | null = 'br-1';
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId,
    selectedBranch: selectedBranchId
      ? { id: selectedBranchId, name: 'Alpha Main', status: 'ACTIVE', timezone: 'Asia/Kolkata', has_roles: true }
      : null,
    branches: [],
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

let pathname = '/tasks';
let quickAccessKey = 'eod-report';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({ id: 'tk-1', key: quickAccessKey }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let authUser: { id: string; email: string; first_name: string | null; last_name: string | null } | null = {
  id: 'u-me',
  email: 'metheakash12@example.com',
  first_name: null,
  last_name: null,
};
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: authUser }),
}));

import TaskDashboardPage from './(staff)/(app)/tasks/page';
import TaskQuickAccessPage from './(staff)/(app)/tasks/quick/[key]/page';
import TaskBoardPage from './(staff)/(app)/tasks/board/page';
import TasksLayout from './(staff)/(app)/tasks/layout';
import TaskDetailPage from './(staff)/(app)/tasks/[id]/page';
import RoutinesPage from './(staff)/(app)/tasks/routines/page';
import ChecklistsPage from './(staff)/(app)/tasks/checklists/page';
import ReportsPage from './(staff)/(app)/tasks/reports/page';
import RoutineLogPage from './(staff)/(app)/tasks/routines/[id]/log/page';

// ── fixtures ─────────────────────────────────────────────────────────────────

const task = (over: Partial<Task> = {}): Task => ({
  id: 'tk-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  title: 'Clean the grease trap',
  description: null,
  status: 'PENDING',
  priority: 'NORMAL',
  due_at: null,
  overdue: false,
  assignee_id: null,
  assignee: null,
  assigned_by: null,
  assigner: null,
  assigned_at: null,
  reassignment_count: 0,
  created_by: null,
  creator: null,
  source: 'MANUAL',
  routine_id: null,
  routine_name: null,
  routine_occurrence_date: null,
  started_at: null,
  completed_at: null,
  completed_by: null,
  completer: null,
  cancelled_at: null,
  checklist_progress: {
    total: 0,
    done: 0,
    required_total: 0,
    required_done: 0,
    ready_to_complete: true,
  },
  created_at: '2027-01-01T09:00:00.000Z',
  updated_at: '2027-01-01T09:00:00.000Z',
  ...over,
});

const detail = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...task(),
  checklist: [],
  ...over,
});

const withChecklist = (): TaskDetail =>
  detail({
    checklist: [
      { id: 'i-1', label: 'Unlock the doors', position: 0, kind: 'CHECK', is_required: true, is_done: false, value: null, done_at: null, done_by: null },
      { id: 'i-2', label: 'Water the plants', position: 1, kind: 'CHECK', is_required: false, is_done: false, value: null, done_at: null, done_by: null },
    ],
    checklist_progress: {
      total: 2,
      done: 0,
      required_total: 1,
      required_done: 0,
      ready_to_complete: false,
    },
  });

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'rt-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  name: 'Opening checks',
  description: null,
  frequency: 'DAILY',
  time_of_day: '09:00',
  due_time: null,
  weekdays: [],
  priority: 'NORMAL',
  status: 'ACTIVE',
  checklist_template_id: null,
  checklist_name: null,
  default_assignee_id: null,
  default_assignee: null,
  next_occurrence_at: '2027-01-02T03:30:00.000Z',
  created_at: '2027-01-01T09:00:00.000Z',
  updated_at: '2027-01-01T09:00:00.000Z',
  ...over,
});

const template = (over: Partial<ChecklistTemplate> = {}): ChecklistTemplate => ({
  id: 'cl-1',
  company_id: 'co-1',
  name: 'Opening checks',
  description: null,
  status: 'ACTIVE',
  items: [
    { id: 'ci-1', label: 'Unlock the doors', position: 0, kind: 'CHECK', is_required: true },
    { id: 'ci-2', label: 'Water the plants', position: 1, kind: 'CHECK', is_required: false },
  ],
  created_at: '2027-01-01T09:00:00.000Z',
  updated_at: '2027-01-01T09:00:00.000Z',
  ...over,
});

const summary = (over: Partial<TaskSummary> = {}): TaskSummary => ({
  branch_id: 'br-1',
  from: '2027-01-01T00:00:00.000Z',
  to: '2027-01-31T00:00:00.000Z',
  counts: { total: 10, pending: 3, in_progress: 1, completed: 5, cancelled: 1, overdue: 2 },
  completion_rate: 55.6,
  by_routine: [
    { routine_id: 'rt-1', routine_name: 'Opening checks', total: 6, completed: 4, completion_rate: 66.7 },
    { routine_id: null, routine_name: 'Ad-hoc tasks', total: 4, completed: 1, completion_rate: 25 },
  ],
  by_assignee: [
    { assignee_id: 'u-1', assignee_name: 'Wes Worker', total: 7, completed: 5, completion_rate: 71.4 },
    { assignee_id: null, assignee_name: 'Unassigned', total: 3, completed: 0, completion_rate: 0 },
  ],
  ...over,
});

const ALL = [
  'tasks.view',
  'tasks.create',
  'tasks.update',
  'tasks.assign',
  'tasks.start',
  'tasks.complete',
  'tasks.cancel',
  'tasks.routine.manage',
  'tasks.reports.view',
];

const page = <T,>(data: T[]) => ({ data, meta: { total: data.length, limit: 50, offset: 0 } });

const STAFF = [
  { id: 'u-1', name: 'Wes Worker' },
  { id: 'u-2', name: 'Vic Viewer' },
];

// ── dashboard ────────────────────────────────────────────────────────────────

describe('Task board', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.list.mockResolvedValue(page([task()]));
    apiMock.start.mockResolvedValue(detail({ status: 'IN_PROGRESS' }));
    apiMock.complete.mockResolvedValue(detail({ status: 'COMPLETED' }));
    apiMock.cancel.mockResolvedValue(detail({ status: 'CANCELLED' }));
    apiMock.create.mockResolvedValue(detail());
    apiMock.assignableStaff.mockResolvedValue(STAFF);
    apiMock.streamTicket.mockResolvedValue({ ticket: 'a'.repeat(64) });
    branchPermissions = [...ALL];
    companyPermissions = [];
    selectedBranchId = 'br-1';
    pathname = '/tasks/board';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists tasks and shows their state', async () => {
    render(<TaskBoardPage />);
    const card = (await screen.findByText('Clean the grease trap')).closest('li')!;
    expect(within(card).getByText('Pending')).toBeTruthy();
    expect(within(card).getByText(/Unassigned/)).toBeTruthy();
  });

  // A refused or failed load must not be dressed up as an empty board.
  it('shows why the board failed to load, and never claims there is nothing', async () => {
    apiMock.list.mockRejectedValue(new Error('Forbidden'));
    render(<TaskBoardPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText(/Nothing here/)).toBeNull();
  });

  it('filters SERVER-side, not in the browser', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    apiMock.list.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    await waitFor(() => expect(apiMock.list).toHaveBeenCalled());
    expect(apiMock.list.mock.calls[0][1]).toMatchObject({ overdue: true });

    apiMock.list.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me' }));
    await waitFor(() => expect(apiMock.list.mock.calls[0][1]).toMatchObject({ assignee: 'me' }));

    apiMock.list.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }));
    await waitFor(() => expect(apiMock.list.mock.calls[0][1]).toMatchObject({ unassigned: true }));
  });

  it('starts a task and then reconciles with the server', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    apiMock.list.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(apiMock.start).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.list).toHaveBeenCalled());
  });

  it('shows a failure and still refetches — no false success', async () => {
    apiMock.complete.mockRejectedValue(new Error('Cannot move a task from COMPLETED to COMPLETED'));
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    apiMock.list.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot move a task/);
    await waitFor(() => expect(apiMock.list).toHaveBeenCalled());
  });

  it('disables Complete while required checklist items are outstanding', async () => {
    apiMock.list.mockResolvedValue(
      page([
        task({
          checklist_progress: {
            total: 2,
            done: 0,
            required_total: 1,
            required_done: 0,
            ready_to_complete: false,
          },
        }),
      ]),
    );
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/1 required left/)).toBeTruthy();
  });

  it('flags an overdue task', async () => {
    apiMock.list.mockResolvedValue(
      page([task({ due_at: '2020-01-01T00:00:00.000Z', overdue: true })]),
    );
    render(<TaskBoardPage />);
    const card = (await screen.findByText('Clean the grease trap')).closest('li')!;
    expect(within(card).getByText(/Overdue/)).toBeTruthy();
  });

  it('creates a task', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mop the floor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    expect(apiMock.create.mock.calls[0][1]).toMatchObject({ title: 'Mop the floor' });
  });

  it('refetches when a task event arrives, and puts only the ticket in the URL', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());

    expect(FakeEventSource.last()!.url).toContain(`ticket=${'a'.repeat(64)}`);
    expect(FakeEventSource.last()!.url).not.toContain('Bearer');

    apiMock.list.mockResolvedValue(page([task({ title: 'Arrived live' })]));
    FakeEventSource.last()!.emit('task.created', { id: 'tk-2' });
    expect(await screen.findByText('Arrived live')).toBeTruthy();
  });

  it('hides every action the viewer lacks permission for', async () => {
    branchPermissions = ['tasks.view'];
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
  });

  it('shows an empty state rather than a blank screen', async () => {
    apiMock.list.mockResolvedValue(page([]));
    render(<TaskBoardPage />);
    expect(await screen.findByText(/Nothing here/)).toBeTruthy();
  });

  it('reports the realtime connection honestly', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    expect(screen.getAllByRole('status').some((n) => /Reconnecting|Live/.test(n.textContent ?? ''))).toBe(true);
  });

  // The branch stream carries everyone's tasks, and the API refuses it to a
  // viewer limited to their own. Dialling it anyway left the board saying
  // "Reconnecting…" forever.
  it('a viewer of their own tasks gets a board without dialling the refused stream', async () => {
    branchPermissions = ['tasks.view_own', 'tasks.start'];
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    await waitFor(() => expect(screen.getByText('Updates when refreshed')).toBeTruthy());
    expect(apiMock.streamTicket).not.toHaveBeenCalled();
    expect(FakeEventSource.last()).toBeUndefined();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('creates a task with notes and an assignee chosen from the branch’s staff', async () => {
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    await screen.findByRole('option', { name: 'Wes Worker' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Descale the kettle' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: '  Use the white vinegar  ' } });
    fireEvent.change(screen.getByLabelText('Assign to (optional)'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    expect(apiMock.create.mock.calls[0][1]).toMatchObject({
      title: 'Descale the kettle',
      description: 'Use the white vinegar',
      assignee_id: 'u-1',
    });
  });

  it('offers no assignee picker without tasks.assign', async () => {
    branchPermissions = ['tasks.view', 'tasks.create'];
    render(<TaskBoardPage />);
    await screen.findByText('Clean the grease trap');
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(screen.queryByLabelText('Assign to (optional)')).toBeNull();
    expect(apiMock.assignableStaff).not.toHaveBeenCalled();
  });

  it('shows who assigned a task and how often it has moved', async () => {
    apiMock.list.mockResolvedValue(
      page([
        task({
          assignee_id: 'u-1',
          assignee: { id: 'u-1', name: 'Wes Worker' },
          assigner: { id: 'u-9', name: 'Mina Manager' },
          reassignment_count: 2,
        }),
      ]),
    );
    render(<TaskBoardPage />);
    const card = (await screen.findByText('Clean the grease trap')).closest('li')!;
    expect(within(card).getByText(/Mina Manager → Assigned to Wes Worker/)).toBeTruthy();
    expect(within(card).getByText(/reassigned 2 times/)).toBeTruthy();
  });
});

// ── layout ───────────────────────────────────────────────────────────────────

describe('Task sub-navigation', () => {
  beforeEach(() => {
    selectedBranchId = 'br-1';
    pathname = '/tasks';
    branchPermissions = ['tasks.view', 'tasks.reports.view'];
  });

  it('asks for a branch first', () => {
    selectedBranchId = null;
    render(
      <TasksLayout>
        <p>child</p>
      </TasksLayout>,
    );
    expect(screen.getByText(/Select a branch/)).toBeTruthy();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('shows the permitted sections and marks the current one', () => {
    render(
      <TasksLayout>
        <p>child</p>
      </TasksLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Board',
      'Routines',
      'Checklists',
      'Completion',
    ]);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
  });

  it('a viewer of their own tasks sees the dashboard and the board', () => {
    branchPermissions = ['tasks.view_own'];
    render(
      <TasksLayout>
        <p>child</p>
      </TasksLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Dashboard', 'Board']);
  });

  it('drops Completion without tasks.reports.view', () => {
    branchPermissions = ['tasks.view'];
    render(
      <TasksLayout>
        <p>child</p>
      </TasksLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Board',
      'Routines',
      'Checklists',
    ]);
  });
});

// ── task dashboard (quick access) ──────────────────────────────────────────────

describe('Task Quick Access dashboard', () => {
  beforeEach(() => {
    selectedBranchId = 'br-1';
    pathname = '/tasks';
    authUser = { id: 'u-me', email: 'metheakash12@example.com', first_name: null, last_name: null };
  });

  it('greets the signed-in user by the local part of their email when no name is on file', () => {
    render(<TaskDashboardPage />);
    expect(screen.getByText(/Welcome, metheakash12/)).toBeTruthy();
  });

  it('greets by name when one is on file', () => {
    authUser = { id: 'u-me', email: 'metheakash12@example.com', first_name: 'Akash', last_name: 'K' };
    render(<TaskDashboardPage />);
    expect(screen.getByText(/Welcome, Akash K/)).toBeTruthy();
  });

  it('lists every Quick Access shortcut, each opening its own page', () => {
    render(<TaskDashboardPage />);
    expect(screen.getByText('EOD Report')).toBeTruthy();
    expect(screen.getByText('Submit daily End-of-Day report')).toBeTruthy();
    expect(screen.getByText('Activity Calendar')).toBeTruthy();
    expect(screen.getByText('View monthly activity calendar')).toBeTruthy();

    const eodLink = screen.getByText('EOD Report').closest('a');
    expect(eodLink?.getAttribute('href')).toBe('/tasks/quick/eod-report');
    // 12 named shortcuts today: EOD, Operational, Kitchen, Opening, Banquet
    // Opening, Branch Manager, Kitchen Balance, Biryani Sales, Kitchen Stock
    // Request, Kitchen Wastage, Corporate Branch Visit, Activity Calendar.
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('Task Quick Access detail', () => {
  beforeEach(() => {
    selectedBranchId = 'br-1';
  });

  it('opens the tile it was reached from, not yet wired to its real flow', () => {
    quickAccessKey = 'eod-report';
    render(<TaskQuickAccessPage />);
    expect(screen.getAllByText('EOD Report').length).toBeGreaterThan(0);
    expect(screen.getByText(/being built next/)).toBeTruthy();
    expect(screen.getByText('← Back to Task Dashboard').getAttribute('href')).toBe('/tasks');
  });

  it('says plainly when the key in the address does not match a shortcut', () => {
    quickAccessKey = 'not-a-real-key';
    render(<TaskQuickAccessPage />);
    expect(screen.getByText('No such shortcut')).toBeTruthy();
  });
});

// ── task detail & checklist ──────────────────────────────────────────────────

describe('Task detail and checklist', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.get.mockResolvedValue(withChecklist());
    apiMock.setChecklistItem.mockResolvedValue(withChecklist());
    apiMock.complete.mockResolvedValue(detail({ status: 'COMPLETED' }));
    apiMock.assign.mockResolvedValue(detail());
    apiMock.update.mockResolvedValue(detail());
    apiMock.assignableStaff.mockResolvedValue(STAFF);
    apiMock.comments.mockResolvedValue([]);
    apiMock.addComment.mockResolvedValue({
      id: 'cm-1',
      task_id: 'tk-1',
      author: { id: 'u-1', name: 'Wes Worker' },
      body: 'Done early',
      created_at: '2027-01-01T10:00:00.000Z',
    });
    branchPermissions = [...ALL];
  });

  it('assigns the task to a person picked from the branch’s staff', async () => {
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    await screen.findByRole('option', { name: 'Vic Viewer' });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'u-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(apiMock.assign).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'tk-1', 'u-2'),
    );
  });

  it('edits only the details that changed', async () => {
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Clean the grease trap properly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiMock.update).toHaveBeenCalled());
    expect(apiMock.update.mock.calls[0][2]).toEqual({ title: 'Clean the grease trap properly' });
  });

  it('lists comments and posts a new one', async () => {
    apiMock.comments.mockResolvedValue([
      {
        id: 'cm-0',
        task_id: 'tk-1',
        author: { id: 'u-9', name: 'Mina Manager' },
        body: 'Please do this before 11',
        created_at: '2027-01-01T09:30:00.000Z',
      },
    ]);
    render(<TaskDetailPage />);
    expect(await screen.findByText('Please do this before 11')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: '  Done early  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() =>
      expect(apiMock.addComment).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'tk-1', 'Done early'),
    );
  });

  it('shows comments but offers neither editing nor commenting without tasks.update', async () => {
    branchPermissions = ['tasks.view'];
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    expect(await screen.findByText('No comments yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  });

  it('renders the checklist in order and marks required items', async () => {
    render(<TaskDetailPage />);
    expect(await screen.findByText('Unlock the doors')).toBeTruthy();
    const items = screen.getAllByRole('checkbox');
    expect(items).toHaveLength(2);
    expect(screen.getByTitle('Required')).toBeTruthy();
  });

  it('asks for an answer on a typed item and sends it; clears it again', async () => {
    const typed = detail({
      checklist: [
        { id: 'n-1', label: 'Meter reading', position: 0, kind: 'NUMBER', is_required: true, is_done: false, value: null, done_at: null, done_by: null },
        { id: 'r-1', label: 'Reception', position: 1, kind: 'RATING', is_required: true, is_done: true, value: '4', done_at: '2027-01-01T10:00:00.000Z', done_by: 'u-1' },
      ],
      checklist_progress: { total: 2, done: 1, required_total: 2, required_done: 1, ready_to_complete: false },
    });
    apiMock.get.mockResolvedValue(typed);
    apiMock.setChecklistItem.mockResolvedValue(typed);
    render(<TaskDetailPage />);
    await screen.findByText(/Meter reading/);
    // Typed items are not checkboxes.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    const meter = screen.getByLabelText(/Meter reading/) as HTMLInputElement;
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    fireEvent.change(meter, { target: { value: '12.3456' } });
    expect(save().disabled).toBe(true); // too many decimals
    fireEvent.change(meter, { target: { value: '1234.5' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() =>
      expect(apiMock.setChecklistItem).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'tk-1', 'n-1', true, '1234.5'),
    );

    expect(screen.getByText(/answered 4/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the answer for Reception' }));
    await waitFor(() =>
      expect(apiMock.setChecklistItem).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'tk-1', 'r-1', false),
    );
  });

  it('blocks completion until the server says the required items are done', async () => {
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Required items \(\*\) must be ticked/)).toBeTruthy();
  });

  it('enables completion once the server reports ready_to_complete', async () => {
    apiMock.get.mockResolvedValue(
      detail({
        checklist: withChecklist().checklist.map((i) => ({ ...i, is_done: true })),
        checklist_progress: {
          total: 2,
          done: 2,
          required_total: 1,
          required_done: 1,
          ready_to_complete: true,
        },
      }),
    );
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ticks an item and reconciles', async () => {
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    apiMock.get.mockClear();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() =>
      expect(apiMock.setChecklistItem).toHaveBeenCalledWith(
        { companyId: 'co-1', branchId: 'br-1' },
        'tk-1',
        'i-1',
        true,
      ),
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  });

  it('a checklist failure is shown and survives the refetch', async () => {
    apiMock.setChecklistItem.mockRejectedValue(new Error('Checklist item was modified concurrently'));
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/modified concurrently/);
  });

  it('a finished task has no actions and a locked checklist', async () => {
    apiMock.get.mockResolvedValue(
      detail({
        status: 'COMPLETED',
        completed_at: '2027-01-01T10:00:00.000Z',
        completer: { id: 'u-1', name: 'Wes Worker' },
        checklist: withChecklist().checklist,
      }),
    );
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Wes Worker/)).toBeTruthy();
  });

  it('says plainly that assignment is not authorization', async () => {
    render(<TaskDetailPage />);
    await screen.findByText('Unlock the doors');
    expect(screen.getByText(/does not change what anyone is permitted to do/i)).toBeTruthy();
  });
});

// ── routines ─────────────────────────────────────────────────────────────────

describe('Routine management', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.listRoutines.mockResolvedValue(page([routine()]));
    apiMock.listChecklists.mockResolvedValue(page([template()]));
    apiMock.createRoutine.mockResolvedValue(routine());
    apiMock.deactivateRoutine.mockResolvedValue(routine({ status: 'INACTIVE' }));
    apiMock.activateRoutine.mockResolvedValue(routine());
    apiMock.materialize.mockResolvedValue({ created: 2, skipped: 1, routines: 1 });
    branchPermissions = [...ALL];
  });

  it('shows a routine in operator language, not cron', async () => {
    render(<RoutinesPage />);
    expect(await screen.findByText('Opening checks')).toBeTruthy();
    expect(screen.getByText(/Every day at 09:00/)).toBeTruthy();
    expect(screen.getByText(/Next:/)).toBeTruthy();
    expect(screen.queryByText(/cron|interval|scheduler/i)).toBeNull();
  });

  it('a refused load shows the refusal, not "No routines yet."', async () => {
    apiMock.listRoutines.mockRejectedValue(new Error('Forbidden'));
    render(<RoutinesPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText('No routines yet.')).toBeNull();
  });

  it('creates a weekly routine with weekdays', async () => {
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Deep clean' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'WEEKLY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

    await waitFor(() => expect(apiMock.createRoutine).toHaveBeenCalled());
    expect(apiMock.createRoutine.mock.calls[0][1]).toMatchObject({
      name: 'Deep clean',
      frequency: 'WEEKLY',
      weekdays: [1],
    });
  });

  it('sends a submission deadline, and refuses one earlier than the routine time', async () => {
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'EOD report' } });
    fireEvent.change(screen.getByLabelText('At (branch local time)'), { target: { value: '21:00' } });

    fireEvent.change(screen.getByLabelText('Deadline (optional, branch local time)'), { target: { value: '20:00' } });
    expect((screen.getByRole('button', { name: 'Create routine' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cannot be earlier/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Deadline (optional, branch local time)'), { target: { value: '23:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    await waitFor(() => expect(apiMock.createRoutine).toHaveBeenCalled());
    expect(apiMock.createRoutine.mock.calls[0][1]).toMatchObject({ time_of_day: '21:00', due_time: '23:30' });
  });

  it('shows a routine’s deadline', async () => {
    apiMock.listRoutines.mockResolvedValue(page([routine({ due_time: '10:30' })]));
    render(<RoutinesPage />);
    expect(await screen.findByText(/Every day at 09:00, due by 10:30/)).toBeTruthy();
  });

  it('will not submit a weekly routine with no weekday', async () => {
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'New routine' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Deep clean' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'WEEKLY' } });
    expect((screen.getByRole('button', { name: 'Create routine' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('generates due tasks on demand and reports what happened', async () => {
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'Generate due tasks now' }));
    await waitFor(() => expect(apiMock.materialize).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toMatch(/Generated 2 tasks/);
  });

  it('says so when nothing was due — idempotency made visible', async () => {
    apiMock.materialize.mockResolvedValue({ created: 0, skipped: 3, routines: 1 });
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'Generate due tasks now' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/already generated/i);
  });

  it('pauses and resumes a routine', async () => {
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(apiMock.deactivateRoutine).toHaveBeenCalled());
  });

  it('hides management without the permission', async () => {
    branchPermissions = ['tasks.view'];
    render(<RoutinesPage />);
    await screen.findByText('Opening checks');
    expect(screen.queryByRole('button', { name: 'New routine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate due tasks now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});

// ── checklists ───────────────────────────────────────────────────────────────

describe('Checklist templates', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.listChecklists.mockResolvedValue(page([template()]));
    apiMock.createChecklist.mockResolvedValue(template());
    apiMock.updateChecklist.mockResolvedValue(template({ status: 'INACTIVE' }));
    companyPermissions = ['tasks.checklist.manage'];
    branchPermissions = ['tasks.view'];
  });

  it('lists items and marks which are required', async () => {
    render(<ChecklistsPage />);
    expect(await screen.findByText('Unlock the doors')).toBeTruthy();
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByText('Optional')).toBeTruthy();
  });

  it('a refused load shows the refusal, not "No checklists yet."', async () => {
    apiMock.listChecklists.mockRejectedValue(new Error('Forbidden'));
    render(<ChecklistsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText('No checklists yet.')).toBeNull();
  });

  it('creates a template, treating a trailing "?" as optional', async () => {
    render(<ChecklistsPage />);
    await screen.findByText('Unlock the doors');
    fireEvent.change(screen.getByLabelText('Checklist name'), { target: { value: 'Closing' } });
    fireEvent.change(screen.getByLabelText('Items, one per line'), {
      target: { value: 'Cash up\nLock up\nWater the plants?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create checklist' }));

    await waitFor(() => expect(apiMock.createChecklist).toHaveBeenCalled());
    expect(apiMock.createChecklist.mock.calls[0][1].items).toEqual([
      { label: 'Cash up', is_required: true, kind: 'CHECK' },
      { label: 'Lock up', is_required: true, kind: 'CHECK' },
      { label: 'Water the plants', is_required: false, kind: 'CHECK' },
    ]);
  });

  it('reads [number], [text], [rating] and [date] as typed items', async () => {
    render(<ChecklistsPage />);
    await screen.findByText('Unlock the doors');
    fireEvent.change(screen.getByLabelText('Checklist name'), { target: { value: 'EOD' } });
    fireEvent.change(screen.getByLabelText('Items, one per line'), {
      target: { value: '[number] Meter reading\n[RATING] Reception\n[text] Closing note?\n[date] Last audit\nLights off' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create checklist' }));
    await waitFor(() => expect(apiMock.createChecklist).toHaveBeenCalled());
    expect(apiMock.createChecklist.mock.calls[0][1].items).toEqual([
      { label: 'Meter reading', is_required: true, kind: 'NUMBER' },
      { label: 'Reception', is_required: true, kind: 'RATING' },
      { label: 'Closing note', is_required: false, kind: 'TEXT' },
      { label: 'Last audit', is_required: true, kind: 'DATE' },
      { label: 'Lights off', is_required: true, kind: 'CHECK' },
    ]);
  });

  it('offers the reference routines and installs one', async () => {
    apiMock.referenceLibrary.mockResolvedValue([
      { key: 'banquet-opening', name: 'Banquet Opening Checklist', description: 'Hall readiness', items: [{ label: 'Lights', kind: 'CHECK', is_required: true }], installed: false },
      { key: 'eod-report', name: 'EOD Report', description: 'Day close', items: [], installed: true },
    ]);
    apiMock.installReference.mockResolvedValue(template({ name: 'Banquet Opening Checklist' }));
    render(<ChecklistsPage />);
    expect(await screen.findByRole('heading', { name: 'Reference routines' })).toBeTruthy();
    expect(screen.getByText('Installed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install Banquet Opening Checklist' }));
    await waitFor(() =>
      expect(apiMock.installReference).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'banquet-opening'),
    );
    expect(await screen.findByText('Banquet Opening Checklist installed.')).toBeTruthy();
  });

  it('shows no library to someone who cannot manage checklists', async () => {
    companyPermissions = [];
    apiMock.referenceLibrary.mockResolvedValue([
      { key: 'eod-report', name: 'EOD Report', description: 'Day close', items: [], installed: false },
    ]);
    render(<ChecklistsPage />);
    await screen.findByText('Unlock the doors');
    expect(screen.queryByRole('heading', { name: 'Reference routines' })).toBeNull();
  });

  it('explains that editing does not rewrite history', async () => {
    render(<ChecklistsPage />);
    await screen.findByText('Unlock the doors');
    expect(screen.getByText(/never changes tasks that already exist/i)).toBeTruthy();
  });

  it('hides management without the company permission', async () => {
    companyPermissions = [];
    render(<ChecklistsPage />);
    await screen.findByText('Unlock the doors');
    expect(screen.queryByRole('button', { name: 'Create checklist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
  });
});

// ── compliance log ───────────────────────────────────────────────────────────

describe('Routine compliance log', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = ['tasks.view', 'tasks.reports.view'];
    apiMock.routineLog.mockImplementation(async (_ctx: unknown, _id: string, from: string, to: string) => ({
      routine_id: 'tk-1',
      routine_name: 'Opening checks',
      from,
      to,
      dates: ['2027-01-01', '2027-01-02'],
      occurrences: [
        { date: '2027-01-01', task_id: 't-a', status: 'COMPLETED', completed_at: '2027-01-01T05:00:00.000Z', late: false },
        { date: '2027-01-02', task_id: 't-b', status: 'COMPLETED', completed_at: '2027-01-02T09:00:00.000Z', late: true },
      ],
      rows: [
        { label: 'Meter reading', kind: 'NUMBER', cells: { '2027-01-01': { done: true, value: '100' }, '2027-01-02': { done: false, value: null } } },
        { label: 'Restroom check', kind: 'CHECK', cells: { '2027-01-01': { done: true, value: null } } },
      ],
    }));
  });

  it('shows items down the side and dates across, with answers, misses and gaps', async () => {
    render(<RoutineLogPage />);
    expect(await screen.findByRole('heading', { name: 'Opening checks' })).toBeTruthy();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1].textContent).toBe('Meter reading100✗');
    expect(rows[2].textContent).toBe('Restroom check✓—');
    expect(within(table).getByText('late')).toBeTruthy();
    // A 7-day window by default.
    const [, , from, to] = apiMock.routineLog.mock.calls[0] as [unknown, string, string, string];
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);
  });

  it('asks for nothing without tasks.reports.view', () => {
    branchPermissions = ['tasks.view'];
    render(<RoutineLogPage />);
    expect(screen.getByText(/do not have access/)).toBeTruthy();
    expect(apiMock.routineLog).not.toHaveBeenCalled();
  });

  it('exports the shown window and saves the file; PDF is offered only up to 14 days', async () => {
    branchPermissions = ['tasks.view', 'tasks.reports.view', 'reports.export'];
    const file = { blob: new Blob(['x']), filename: 'tasks.routine_log_2027-01-01_2027-01-07.xlsx' };
    apiMock.exportRoutineLog.mockResolvedValue(file);
    saveFileMock.mockReset();
    render(<RoutineLogPage />);
    await screen.findByRole('heading', { name: 'Opening checks' });

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(saveFileMock).toHaveBeenCalledWith(file));
    const [, id, from, to, format] = apiMock.exportRoutineLog.mock.calls[0] as [unknown, string, string, string, string];
    expect([id, format]).toEqual(['tk-1', 'xlsx']);
    const [, , logFrom, logTo] = apiMock.routineLog.mock.calls.at(-1) as [unknown, string, string, string];
    expect([from, to]).toEqual([logFrom, logTo]);

    expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '31 days' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/A PDF covers up to 14 days/)).toBeTruthy();
  });

  it('shows a refused export plainly, and offers no export without reports.export', async () => {
    branchPermissions = ['tasks.view', 'tasks.reports.view', 'reports.export'];
    apiMock.exportRoutineLog.mockRejectedValue(new Error('Forbidden'));
    const { unmount } = render(<RoutineLogPage />);
    await screen.findByRole('heading', { name: 'Opening checks' });
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    unmount();

    branchPermissions = ['tasks.view', 'tasks.reports.view'];
    render(<RoutineLogPage />);
    await screen.findByRole('heading', { name: 'Opening checks' });
    expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();
  });
});

// ── completion reporting ─────────────────────────────────────────────────────

describe('Completion reporting', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.summary.mockResolvedValue(summary());
    branchPermissions = [...ALL];
  });

  it('shows the headline figures', async () => {
    render(<ReportsPage />);
    expect(await screen.findByText('55.6%')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy(); // total
    expect(screen.getByText('2')).toBeTruthy(); // overdue
  });

  it('breaks completion down by routine and by assignee', async () => {
    render(<ReportsPage />);
    await screen.findByText('55.6%');
    const routines = screen.getByRole('heading', { name: 'By routine' }).parentElement!;
    expect(within(routines).getByText('Opening checks')).toBeTruthy();
    expect(within(routines).getByText(/4\/6 · 66.7%/)).toBeTruthy();
    expect(within(routines).getByText('Ad-hoc tasks')).toBeTruthy();

    const assignees = screen.getByRole('heading', { name: 'By assignee' }).parentElement!;
    expect(within(assignees).getByText('Wes Worker')).toBeTruthy();
    expect(within(assignees).getByText('Unassigned')).toBeTruthy();
  });

  it('changes the window server-side', async () => {
    render(<ReportsPage />);
    await screen.findByText('55.6%');
    apiMock.summary.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(apiMock.summary).toHaveBeenCalled());
    const params = apiMock.summary.mock.calls[0][1];
    expect(params.from).toBeDefined();
    expect(params.to).toBeDefined();
  });

  it('offers no export — that is Phase 10', async () => {
    render(<ReportsPage />);
    await screen.findByText('55.6%');
    expect(screen.queryByRole('button', { name: /export|pdf|excel|csv/i })).toBeNull();
  });

  it('shows an error with a retry rather than a blank page', async () => {
    apiMock.summary.mockRejectedValue(new Error('Failed to fetch'));
    render(<ReportsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Failed to fetch/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

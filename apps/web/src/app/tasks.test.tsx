import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { ChecklistTemplate, Routine, Task, TaskDetail, TaskSummary } from '@/lib/tasks/types';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  assign: vi.fn(),
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
  streamTicket: vi.fn(),
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
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

let pathname = '/tasks';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({ id: 'tk-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import TasksPage from './(staff)/(app)/tasks/page';
import TasksLayout from './(staff)/(app)/tasks/layout';
import TaskDetailPage from './(staff)/(app)/tasks/[id]/page';
import RoutinesPage from './(staff)/(app)/tasks/routines/page';
import ChecklistsPage from './(staff)/(app)/tasks/checklists/page';
import ReportsPage from './(staff)/(app)/tasks/reports/page';

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
      { id: 'i-1', label: 'Unlock the doors', position: 0, is_required: true, is_done: false, done_at: null, done_by: null },
      { id: 'i-2', label: 'Water the plants', position: 1, is_required: false, is_done: false, done_at: null, done_by: null },
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
    { id: 'ci-1', label: 'Unlock the doors', position: 0, is_required: true },
    { id: 'ci-2', label: 'Water the plants', position: 1, is_required: false },
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

// ── dashboard ────────────────────────────────────────────────────────────────

describe('Task dashboard', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.list.mockResolvedValue(page([task()]));
    apiMock.start.mockResolvedValue(detail({ status: 'IN_PROGRESS' }));
    apiMock.complete.mockResolvedValue(detail({ status: 'COMPLETED' }));
    apiMock.cancel.mockResolvedValue(detail({ status: 'CANCELLED' }));
    apiMock.create.mockResolvedValue(detail());
    apiMock.streamTicket.mockResolvedValue({ ticket: 'a'.repeat(64) });
    branchPermissions = [...ALL];
    companyPermissions = [];
    selectedBranchId = 'br-1';
    pathname = '/tasks';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists tasks and shows their state', async () => {
    render(<TasksPage />);
    const card = (await screen.findByText('Clean the grease trap')).closest('li')!;
    expect(within(card).getByText('Pending')).toBeTruthy();
    expect(within(card).getByText(/Unassigned/)).toBeTruthy();
  });

  // A refused or failed load must not be dressed up as an empty board.
  it('shows why the board failed to load, and never claims there is nothing', async () => {
    apiMock.list.mockRejectedValue(new Error('Forbidden'));
    render(<TasksPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText(/Nothing here/)).toBeNull();
  });

  it('filters SERVER-side, not in the browser', async () => {
    render(<TasksPage />);
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
    render(<TasksPage />);
    await screen.findByText('Clean the grease trap');
    apiMock.list.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(apiMock.start).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.list).toHaveBeenCalled());
  });

  it('shows a failure and still refetches — no false success', async () => {
    apiMock.complete.mockRejectedValue(new Error('Cannot move a task from COMPLETED to COMPLETED'));
    render(<TasksPage />);
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
    render(<TasksPage />);
    await screen.findByText('Clean the grease trap');
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/1 required left/)).toBeTruthy();
  });

  it('flags an overdue task', async () => {
    apiMock.list.mockResolvedValue(
      page([task({ due_at: '2020-01-01T00:00:00.000Z', overdue: true })]),
    );
    render(<TasksPage />);
    const card = (await screen.findByText('Clean the grease trap')).closest('li')!;
    expect(within(card).getByText(/Overdue/)).toBeTruthy();
  });

  it('creates a task', async () => {
    render(<TasksPage />);
    await screen.findByText('Clean the grease trap');
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mop the floor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    expect(apiMock.create.mock.calls[0][1]).toMatchObject({ title: 'Mop the floor' });
  });

  it('refetches when a task event arrives, and puts only the ticket in the URL', async () => {
    render(<TasksPage />);
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
    render(<TasksPage />);
    await screen.findByText('Clean the grease trap');
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
  });

  it('shows an empty state rather than a blank screen', async () => {
    apiMock.list.mockResolvedValue(page([]));
    render(<TasksPage />);
    expect(await screen.findByText(/Nothing here/)).toBeTruthy();
  });

  it('reports the realtime connection honestly', async () => {
    render(<TasksPage />);
    await screen.findByText('Clean the grease trap');
    expect(screen.getAllByRole('status').some((n) => /Reconnecting|Live/.test(n.textContent ?? ''))).toBe(true);
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
      'Board',
      'Routines',
      'Checklists',
      'Completion',
    ]);
    expect(screen.getByRole('link', { name: 'Board' }).getAttribute('aria-current')).toBe('page');
  });

  it('drops Completion without tasks.reports.view', () => {
    branchPermissions = ['tasks.view'];
    render(
      <TasksLayout>
        <p>child</p>
      </TasksLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Board',
      'Routines',
      'Checklists',
    ]);
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
    branchPermissions = [...ALL];
  });

  it('renders the checklist in order and marks required items', async () => {
    render(<TaskDetailPage />);
    expect(await screen.findByText('Unlock the doors')).toBeTruthy();
    const items = screen.getAllByRole('checkbox');
    expect(items).toHaveLength(2);
    expect(screen.getByTitle('Required')).toBeTruthy();
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
      { label: 'Cash up', is_required: true },
      { label: 'Lock up', is_required: true },
      { label: 'Water the plants', is_required: false },
    ]);
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

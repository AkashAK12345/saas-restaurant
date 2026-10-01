import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { AccessCatalogue, UserAccessDetail, UserListEntry } from '@/lib/users/access';

const apiMock = vi.hoisted(() => ({
  catalogue: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
}));
const groupsMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/users/access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/users/access')>('@/lib/users/access');
  return { ...actual, userAccessApi: apiMock, userGroupsApi: groupsMock };
});

let companyPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1', selectedBranchId: null, companyPermissions, branchPermissions: [] }),
}));
let me = { id: 'me-1', email: 'me@test.com', first_name: null, last_name: null };
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ user: me }) }));

import UserManagementPage from './(staff)/(app)/settings/users/page';
import EditUserPage from './(staff)/(app)/settings/users/[id]/page';

const CATALOGUE: AccessCatalogue = {
  sections: [
    {
      key: 'queue',
      title: 'Queue & Podium',
      toggles: [
        { key: 'queue.admin_display', label: 'Admin Display', available: true },
        { key: 'queue.podium', label: 'Podium Operator', available: true },
        { key: 'queue.waiter', label: 'Waiter', available: true },
      ],
    },
    { key: 'banquet', title: 'Banquet', toggles: [{ key: 'banquet.booking', label: 'Booking', available: true }] },
    { key: 'pos', title: 'POS', toggles: [{ key: 'pos.billing', label: 'Billing', available: false }] },
  ],
  routines: [
    { key: 'eod-report', label: 'EOD Reports' },
    { key: 'kitchen-checklist', label: 'Kitchen Checklist' },
  ],
  presets: {
    ADMIN: {
      toggles: ['queue.admin_display', 'queue.podium', 'queue.waiter', 'banquet.booking', 'pos.billing'],
      routines: { 'eod-report': 'MANAGER', 'kitchen-checklist': 'MANAGER' },
      tasks: 'BOTH',
    },
    MANAGER: {
      toggles: ['queue.podium', 'banquet.booking'],
      routines: { 'eod-report': 'MANAGER', 'kitchen-checklist': 'MANAGER' },
      tasks: 'BOTH',
    },
    STAFF: {
      toggles: ['queue.waiter'],
      routines: { 'eod-report': 'STAFF', 'kitchen-checklist': 'STAFF' },
      tasks: 'RECEIVE',
    },
  },
  branches: [
    { id: 'br-1', name: 'Alwarpet' },
    { id: 'br-2', name: 'Anna Nagar' },
  ],
};

const user = (over: Partial<UserListEntry>): UserListEntry => ({
  id: 'u-1',
  email: 'admin@yourapp.com',
  name: 'admin',
  status: 'ACTIVE',
  user_type: 'ADMIN',
  corporate: true,
  branch: null,
  ...over,
});

const USERS: UserListEntry[] = [
  user({}),
  user({ id: 'u-2', email: 'alwarpetba@gmail.com', name: 'alwarpetba', user_type: 'MANAGER', corporate: false, branch: { id: 'br-1', name: 'Alwarpet' } }),
  user({ id: 'u-3', email: 'annawaiter@gmail.com', name: 'annawaiter', user_type: 'STAFF', corporate: false, branch: { id: 'br-2', name: 'Anna Nagar' } }),
];

const pick = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox', { name: label })).getByRole('option', { name: option }));
};

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  apiMock.catalogue.mockResolvedValue(CATALOGUE);
  apiMock.list.mockResolvedValue(USERS);
  companyPermissions = ['users.view', 'users.create', 'users.update'];
  me = { id: 'me-1', email: 'me@test.com', first_name: null, last_name: null };
});

describe('User Management — Existing Users', () => {
  it('lists every member with their branch, and filters by search, branch and type', async () => {
    render(<UserManagementPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'User Management' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Existing Users', 'Create New', 'Groups']);

    const list = await screen.findByRole('list', { name: 'Users' });
    expect(within(list).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/settings/users/u-1',
      '/settings/users/u-2',
      '/settings/users/u-3',
    ]);
    expect(within(list).getByText('Corporate')).toBeTruthy();
    expect(within(list).getByText('AD')).toBeTruthy();
    expect(screen.getByText('3 users')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'alwar' } });
    expect(screen.getByText('1 user')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '' } });

    pick('Role filter', 'Staff');
    expect(within(screen.getByRole('list', { name: 'Users' })).getAllByRole('link')).toHaveLength(1);
    pick('Role filter', 'All Roles');

    pick('Branch filter', 'Corporate');
    expect(screen.getByText('1 user')).toBeTruthy();
    pick('Branch filter', 'Anna Nagar');
    expect(within(screen.getByRole('list', { name: 'Users' })).getByText('annawaiter')).toBeTruthy();
  });

  it('is refused without users.view and asks the API for nothing', () => {
    companyPermissions = [];
    render(<UserManagementPage />);
    expect(screen.getByRole('alert').textContent).toMatch(/permission to manage users/);
    expect(apiMock.list).not.toHaveBeenCalled();
  });

});

describe('User Management — Groups', () => {
  const GROUPS = [
    {
      id: 'g-1',
      name: 'Branch Heads',
      members: [
        { id: 'u-2', name: 'alwarpetba', email: 'alwarpetba@gmail.com' },
        { id: 'u-3', name: 'annawaiter', email: 'annawaiter@gmail.com' },
        { id: 'x-1', name: 'mogappairba', email: 'm@gmail.com' },
        { id: 'x-2', name: 'pallavaramba', email: 'p@gmail.com' },
      ],
    },
    { id: 'g-2', name: 'Deep Clean', members: [] },
  ];

  const openGroups = async () => {
    groupsMock.list.mockResolvedValue(GROUPS);
    render(<UserManagementPage />);
    await screen.findByRole('list', { name: 'Users' });
    fireEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    return screen.findByRole('list', { name: 'Groups' });
  };

  beforeEach(() => {
    for (const fn of Object.values(groupsMock)) fn.mockReset();
  });

  it('lists groups with their size and first members, and searches them', async () => {
    const list = await openGroups();
    const heads = within(list).getByRole('button', { name: 'Branch Heads, 4 members' });
    expect(within(heads).getByText('alwarpetba, annawaiter, mogappairba +1 more')).toBeTruthy();
    expect(within(list).getByText('0 members')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search groups'), { target: { value: 'deep' } });
    expect(within(screen.getByRole('list', { name: 'Groups' })).getAllByRole('button')).toHaveLength(1);
  });

  it('creates a group once it has a name and a member', async () => {
    groupsMock.create.mockResolvedValue({ id: 'g-3', name: 'Kitchen', members: [] });
    await openGroups();
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    const dialog = screen.getByRole('dialog', { name: 'Create group' });
    const create = within(dialog).getByRole('button', { name: 'Create group' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(within(dialog).getByText('0 selected')).toBeTruthy();
    // No MEMBERS heading while the group is empty.
    expect(within(dialog).queryByText('Members')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText('Group name'), { target: { value: ' Kitchen ' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /annawaiter/ }));
    expect(within(dialog).getByText('1 selected')).toBeTruthy();
    fireEvent.click(create);
    await waitFor(() => expect(groupsMock.create).toHaveBeenCalledWith('co-1', { name: 'Kitchen', member_ids: ['u-3'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Kitchen created.')).toBeTruthy();
    expect(groupsMock.list).toHaveBeenCalledTimes(2);
  });

  it('edits a group: members first, then everyone else; saves and deletes', async () => {
    groupsMock.save.mockResolvedValue(GROUPS[0]);
    groupsMock.remove.mockResolvedValue(undefined);
    const list = await openGroups();
    fireEvent.click(within(list).getByRole('button', { name: /Branch Heads/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit group' });
    expect((within(dialog).getByLabelText('Group name') as HTMLInputElement).value).toBe('Branch Heads');
    expect(within(dialog).getByText('4 selected')).toBeTruthy();
    const members = within(dialog).getByRole('list', { name: 'Members' });
    expect(within(members).getAllByRole('checkbox').map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    const all = within(dialog).getByRole('list', { name: 'All users' });
    expect(within(all).getAllByRole('checkbox')).toHaveLength(1);

    // Unticking keeps the row where it is.
    fireEvent.click(within(members).getByRole('checkbox', { name: /annawaiter/ }));
    expect(within(members).getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(groupsMock.save).toHaveBeenCalledWith('co-1', 'g-1', {
        name: 'Branch Heads',
        // Members not shown here (left the company list) are kept as they were.
        member_ids: ['u-2', 'x-1', 'x-2'],
      }),
    );

    fireEvent.click(within(await screen.findByRole('list', { name: 'Groups' })).getByRole('button', { name: /Branch Heads/ }));
    const again = screen.getByRole('dialog', { name: 'Edit group' });
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    expect(groupsMock.remove).not.toHaveBeenCalled();
    fireEvent.click(within(again).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(groupsMock.remove).toHaveBeenCalledWith('co-1', 'g-1'));
  });

  it('is read-only without users.update', async () => {
    companyPermissions = ['users.view'];
    const list = await openGroups();
    expect(screen.queryByRole('button', { name: 'Create group' })).toBeNull();
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('User Management — Create New', () => {
  const openCreate = async () => {
    render(<UserManagementPage />);
    await screen.findByRole('list', { name: 'Users' });
    fireEvent.click(screen.getByRole('tab', { name: 'Create New' }));
    await screen.findByRole('heading', { name: 'Create New User' });
  };

  it('draws the reference sections, routines between Banquet and the rest, and every toggle off', async () => {
    await openCreate();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Queue & Podium',
      'Banquet',
      'Routines (Daily Forms)',
      'Tasks Module',
      'POS',
    ]);
    expect(screen.getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getByRole('button', { name: 'Quick Set User Type' }).textContent).toMatch('Custom');
    expect(screen.getByLabelText('Password').getAttribute('placeholder')).toBe('Min 8 characters');
  });

  it('a section switch turns all its rows on; Bulk mode sets every daily form', async () => {
    await openCreate();
    const queue = screen.getByRole('region', { name: 'Queue & Podium' });
    fireEvent.click(within(queue).getByRole('switch', { name: 'All of Queue & Podium' }));
    expect(within(queue).getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);

    const routines = screen.getByRole('region', { name: 'Routines (Daily Forms)' });
    fireEvent.click(within(within(routines).getByRole('radiogroup', { name: 'Bulk mode' })).getByRole('radio', { name: /Manager/ }));
    for (const form of ['EOD Reports', 'Kitchen Checklist']) {
      const group = within(routines).getByRole('radiogroup', { name: form });
      expect(within(group).getByRole('radio', { name: 'Manager' }).getAttribute('aria-checked')).toBe('true');
    }
    // One form changed by hand reads as Custom.
    fireEvent.click(within(within(routines).getByRole('radiogroup', { name: 'EOD Reports' })).getByRole('radio', { name: 'Off' }));
    expect(within(within(routines).getByRole('radiogroup', { name: 'Bulk mode' })).getByRole('radio', { name: /Custom/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('creates a user from a preset at the chosen branch, then shows the list', async () => {
    apiMock.create.mockResolvedValue({ ...USERS[2], email: 'new@test.com', access: CATALOGUE.presets.STAFF, managed: true });
    await openCreate();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: ' new@test.com ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    pick('Branch', 'Alwarpet');
    pick('Quick Set User Type', 'Staff');
    expect(screen.getByRole('button', { name: 'Quick Set User Type' }).textContent).toMatch('Staff');
    expect(screen.getByRole('switch', { name: 'Waiter' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    await waitFor(() =>
      expect(apiMock.create).toHaveBeenCalledWith('co-1', {
        email: 'new@test.com',
        password: 'Password123',
        user_type: 'STAFF',
        corporate: false,
        branch_id: 'br-1',
        access: CATALOGUE.presets.STAFF,
      }),
    );
    expect(await screen.findByText('new@test.com can now sign in.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Existing Users' }).getAttribute('aria-selected')).toBe('true');
    expect(apiMock.list).toHaveBeenCalledTimes(2);
  });

  it('Corporate places the user at every branch', async () => {
    apiMock.create.mockResolvedValue({ ...USERS[0], access: CATALOGUE.presets.ADMIN, managed: true });
    await openCreate();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'boss@test.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    pick('Branch', 'Corporate (all branches)');
    pick('Quick Set User Type', 'Admin');
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(apiMock.create).toHaveBeenCalled());
    const body = apiMock.create.mock.calls[0][1];
    expect(body).toMatchObject({ user_type: 'ADMIN', corporate: true });
    expect(body.branch_id).toBeUndefined();
  });

  it('checks the form before sending, and shows the server’s refusal', async () => {
    await openCreate();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'new@test.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 8 characters/);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Choose a branch/);
    expect(apiMock.create).not.toHaveBeenCalled();

    apiMock.create.mockRejectedValue(new Error('You cannot give access you do not have yourself: queue.seat'));
    pick('Branch', 'Alwarpet');
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    expect(await screen.findByText(/do not have yourself: queue.seat/)).toBeTruthy();
  });
});

describe('User Management — editing a user', () => {
  const detail = (over: Partial<UserAccessDetail> = {}): UserAccessDetail => ({
    ...USERS[1],
    access: { toggles: ['queue.podium'], routines: { 'eod-report': 'STAFF' }, tasks: 'RECEIVE' },
    managed: false,
    ...over,
  });

  const renderEdit = async (id = 'u-2') => {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <EditUserPage params={Promise.resolve({ id })} />
        </Suspense>,
      );
    });
    await screen.findByRole('heading', { name: 'Edit User' });
  };

  it('starts from what the user has today, and saves the change', async () => {
    apiMock.detail.mockResolvedValue(detail());
    apiMock.save.mockResolvedValue(detail({ managed: true }));
    await renderEdit();
    expect(screen.getByRole('heading', { level: 1, name: 'alwarpetba' })).toBeTruthy();
    expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe('alwarpetba@gmail.com');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByText(/Saving replaces those roles/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Branch' }).textContent).toMatch('Alwarpet');
    expect(screen.getByRole('switch', { name: 'Podium Operator' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('switch', { name: 'Booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(apiMock.save).toHaveBeenCalledWith('co-1', 'u-2', {
        user_type: 'MANAGER',
        corporate: false,
        branch_id: 'br-1',
        access: { toggles: ['queue.podium', 'banquet.booking'], routines: { 'eod-report': 'STAFF' }, tasks: 'RECEIVE' },
      }),
    );
    expect(await screen.findByText('Access saved.')).toBeTruthy();
  });

  it('never lets someone change their own access', async () => {
    me = { ...me, id: 'u-2' };
    apiMock.detail.mockResolvedValue(detail({ managed: true }));
    await renderEdit();
    expect(screen.getByRole('alert').textContent).toMatch('You cannot change your own access');
    expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

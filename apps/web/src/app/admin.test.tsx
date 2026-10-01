import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * Administration screens: customers, tables, display screens, users and roles.
 *
 * Each page is exercised against a mocked API: what it shows, which controls a
 * permission reveals, the exact request a control sends, and how a refusal from
 * the server is surfaced. Hiding a control is never treated as the security
 * boundary — these tests only prove the UI does not offer what it should not.
 */

const lazyProxy = vi.hoisted(
  () =>
    <T extends Record<string, (...args: never[]) => unknown>>(target: T) =>
      new Proxy(target, {
        get: (t, k: string) => (...a: unknown[]) => (t[k] as unknown as (...args: unknown[]) => unknown)(...a),
      }),
);

const apiMock = vi.hoisted(() => ({
  customers: vi.fn(),
  customer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  tables: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  displayDevices: vi.fn(),
  createDisplayDevice: vi.fn(),
  revokeDisplayDevice: vi.fn(),
  users: vi.fn(),
  members: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  setUserStatus: vi.fn(),
  setMembershipStatus: vi.fn(),
  branchRoles: vi.fn(),
  assignBranchRole: vi.fn(),
  removeBranchRole: vi.fn(),
  roles: vi.fn(),
  permissionCatalogue: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  setRolePermissions: vi.fn(),
}));
const queueMock = vi.hoisted(() => ({ tableAvailability: vi.fn() }));

vi.mock('@/lib/admin/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin/api')>('@/lib/admin/api');
  return { ...actual, adminApi: lazyProxy(apiMock) };
});
vi.mock('@/lib/queue/api', () => ({ queueApi: lazyProxy(queueMock) }));
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'u-me', email: 'me@test', first_name: 'Me', last_name: null } }),
}));

let companyPermissions: string[] = [];
let branchPermissions: string[] = [];
let branchSelected = true;
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: branchSelected ? 'br-1' : null,
    selectedBranch: branchSelected
      ? { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true }
      : null,
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

import CustomersPage from './(staff)/(app)/customers/page';
import TablesPage from './(staff)/(app)/tables/page';
import DisplaysPage from './(staff)/(app)/displays/page';

const T = '2026-09-01T10:00:00.000Z';
const page = <X,>(data: X[]) => ({ data, meta: { total: data.length, limit: 25, offset: 0 } });

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  queueMock.tableAvailability.mockReset();
  companyPermissions = [];
  branchPermissions = [];
  branchSelected = true;
});

// ── Customers ────────────────────────────────────────────────────────────────

describe('Customers', () => {
  const priya = {
    id: 'c-1',
    company_id: 'co-1',
    name: 'Priya Sharma',
    phone: '+919800000001',
    status: 'ACTIVE',
    created_at: T,
    updated_at: T,
  };

  it('refuses without customers.view and never calls the API', () => {
    render(<CustomersPage />);
    expect(screen.getByText('You do not have access to customers.')).toBeTruthy();
    expect(apiMock.customers).not.toHaveBeenCalled();
  });

  it('lists with masked phones, and the details panel shows the full number', async () => {
    companyPermissions = ['customers.view'];
    apiMock.customers.mockResolvedValue(page([priya]));
    render(<CustomersPage />);

    const table = await screen.findByRole('table', { name: 'Customers' });
    expect(within(table).getByText('••••0001')).toBeTruthy();
    expect(within(table).queryByText('+919800000001')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull();

    fireEvent.click(within(table).getByRole('button', { name: 'Priya Sharma' }));
    const details = screen.getByRole('complementary', { name: 'Customer details' });
    expect(within(details).getByText('+919800000001')).toBeTruthy();
    // View-only: no edit controls.
    expect(within(details).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('searches on the server with the typed text and chosen status', async () => {
    companyPermissions = ['customers.view'];
    apiMock.customers.mockResolvedValue(page([]));
    render(<CustomersPage />);
    await screen.findByText('No customers yet.');

    fireEvent.change(screen.getByLabelText('Search name or phone'), { target: { value: ' priya ' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(apiMock.customers).toHaveBeenLastCalledWith('co-1', { q: 'priya', status: 'INACTIVE', limit: 25, offset: 0 }),
    );
    expect(await screen.findByText('No customers match this search.')).toBeTruthy();
  });

  it('adds a customer, and shows the server refusal on a duplicate phone', async () => {
    companyPermissions = ['customers.view', 'customers.create'];
    apiMock.customers.mockResolvedValue(page([]));
    apiMock.createCustomer.mockRejectedValueOnce(new Error('A customer with this phone already exists in this company'));
    render(<CustomersPage />);
    await screen.findByText('No customers yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Arun' } });
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '9800000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect((await screen.findByRole('alert')).textContent).toMatch('already exists');
    expect(apiMock.createCustomer).toHaveBeenCalledWith('co-1', { name: 'Arun', phone: '9800000001' });

    apiMock.createCustomer.mockResolvedValueOnce({ ...priya, id: 'c-2', name: 'Arun', phone: null });
    fireEvent.change(screen.getByLabelText('Phone (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Added Arun.')).toBeTruthy();
    expect(apiMock.createCustomer).toHaveBeenLastCalledWith('co-1', { name: 'Arun' });
  });

  it('with customers.update, marks a customer inactive', async () => {
    companyPermissions = ['customers.view', 'customers.update'];
    apiMock.customers.mockResolvedValue(page([priya]));
    apiMock.updateCustomer.mockResolvedValue({ ...priya, status: 'INACTIVE' });
    render(<CustomersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Priya Sharma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark inactive' }));
    await waitFor(() => expect(apiMock.updateCustomer).toHaveBeenCalledWith('co-1', 'c-1', { status: 'INACTIVE' }));
    expect(await screen.findByText('Priya Sharma is now inactive.')).toBeTruthy();
  });
});

// ── Tables ───────────────────────────────────────────────────────────────────

describe('Tables', () => {
  const t1 = { id: 't-1', branch_id: 'br-1', label: 'T1', capacity: 4, zone: 'Terrace', status: 'ACTIVE', created_at: T, updated_at: T };
  const t2 = { ...t1, id: 't-2', label: 'T2', capacity: 2, zone: null };

  it('asks for a branch first', () => {
    branchSelected = false;
    branchPermissions = ['tables.view'];
    render(<TablesPage />);
    expect(screen.getByText('Select a branch first.')).toBeTruthy();
    expect(apiMock.tables).not.toHaveBeenCalled();
  });

  it('refuses without tables.view at the branch', () => {
    render(<TablesPage />);
    expect(screen.getByText('You do not have access to tables at this branch.')).toBeTruthy();
    expect(apiMock.tables).not.toHaveBeenCalled();
  });

  it('lists tables with seats, zone and live occupancy from the queue', async () => {
    branchPermissions = ['tables.view', 'queue.view'];
    apiMock.tables.mockResolvedValue(page([t1, t2]));
    queueMock.tableAvailability.mockResolvedValue([
      { ...t1, occupied_by: { token_id: 'q', token_number: 12, service_date: '2026-09-01' } },
      { ...t2, occupied_by: null },
    ]);
    render(<TablesPage />);
    const list = await screen.findByRole('list', { name: 'Tables' });
    expect(await within(list).findByText('Occupied — token 12')).toBeTruthy();
    expect(within(list).getByText('Free')).toBeTruthy();
    expect(within(list).getByText('4 seats · Terrace')).toBeTruthy();
    expect(screen.getByText(/2 tables, 6 seats in service/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add table' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit table/ })).toBeNull();
  });

  it('without queue.view, never asks the queue', async () => {
    branchPermissions = ['tables.view'];
    apiMock.tables.mockResolvedValue(page([t1]));
    render(<TablesPage />);
    await screen.findByRole('list', { name: 'Tables' });
    expect(queueMock.tableAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText('Free')).toBeNull();
  });

  it('adds a table with a numeric capacity in the branch context', async () => {
    branchPermissions = ['tables.view', 'tables.create'];
    apiMock.tables.mockResolvedValue(page([]));
    apiMock.createTable.mockResolvedValue({ ...t1, label: 'T9' });
    render(<TablesPage />);
    await screen.findByText('This branch has no tables yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'T9' } });
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    await waitFor(() => expect(apiMock.createTable).toHaveBeenCalledWith('co-1', 'br-1', { label: 'T9', capacity: 6 }));
    expect(await screen.findByText('Added table T9.')).toBeTruthy();
  });

  it('shows why a seated table cannot be taken out of service', async () => {
    branchPermissions = ['tables.view', 'tables.update'];
    apiMock.tables.mockResolvedValue(page([t1]));
    apiMock.updateTable.mockRejectedValue(new Error('This table is occupied by a seated party; release it before deactivating'));
    render(<TablesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take out of service table T1' }));
    await waitFor(() => expect(apiMock.updateTable).toHaveBeenCalledWith('co-1', 'br-1', 't-1', { status: 'INACTIVE' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('occupied by a seated party');
  });
});

// ── Displays ─────────────────────────────────────────────────────────────────

describe('Displays', () => {
  const device = {
    id: 'd-1',
    branch_id: 'br-1',
    name: 'Door screen',
    kind: 'QUEUE_CUSTOMER',
    status: 'ACTIVE',
    revoked_at: null,
    created_at: T,
    updated_at: T,
  };

  it('lists screens without offering pairing or revoking to a viewer', async () => {
    branchPermissions = ['display_devices.view'];
    apiMock.displayDevices.mockResolvedValue(page([device]));
    render(<DisplaysPage />);
    const list = await screen.findByRole('list', { name: 'Display screens' });
    expect(within(list).getByText('Door screen')).toBeTruthy();
    expect(within(list).getByText('Queue — customer screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pair a screen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke Door screen' })).toBeNull();
  });

  it('shows the pairing code once, and forgets it on Done', async () => {
    branchPermissions = ['display_devices.view', 'display_devices.create'];
    apiMock.displayDevices.mockResolvedValue(page([]));
    apiMock.createDisplayDevice.mockResolvedValue({ device: { ...device, kind: 'BANQUET_CHEF', name: 'Kitchen' }, credential: 'd-1.secretvalue' });
    render(<DisplaysPage />);
    await screen.findByText('No screens are paired to this branch.');

    fireEvent.click(screen.getByRole('button', { name: 'Pair a screen' }));
    fireEvent.change(screen.getByLabelText('Screen name'), { target: { value: 'Kitchen' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'BANQUET_CHEF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair screen' }));

    await waitFor(() =>
      expect(apiMock.createDisplayDevice).toHaveBeenCalledWith('co-1', 'br-1', { name: 'Kitchen', kind: 'BANQUET_CHEF' }),
    );
    const region = await screen.findByRole('region', { name: 'Pairing code' });
    expect(within(region).getByLabelText('One-time pairing code').textContent).toMatch('d-1.secretvalue');
    expect(within(region).getByText('/display/banquet')).toBeTruthy();

    fireEvent.click(within(region).getByRole('button', { name: 'Done — hide the code' }));
    expect(screen.queryByText('d-1.secretvalue')).toBeNull();
  });

  it('revokes only after a confirmation', async () => {
    branchPermissions = ['display_devices.view', 'display_devices.revoke'];
    apiMock.displayDevices.mockResolvedValue(page([device]));
    apiMock.revokeDisplayDevice.mockResolvedValue({ ...device, status: 'REVOKED', revoked_at: T });
    render(<DisplaysPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Door screen' }));
    expect(apiMock.revokeDisplayDevice).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Confirm revoking Door screen' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, revoke' }));
    await waitFor(() => expect(apiMock.revokeDisplayDevice).toHaveBeenCalledWith('co-1', 'br-1', 'd-1'));
    expect(await screen.findByText(/Door screen is revoked/)).toBeTruthy();
  });
});

// ── Users ────────────────────────────────────────────────────────────────────

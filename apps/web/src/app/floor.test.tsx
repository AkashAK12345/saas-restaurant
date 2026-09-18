import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueueBoard, QueueToken } from '@/lib/queue/types';

/**
 * The waiter's table management (/queue/tables) and the per-record history panel.
 */

const refresh = vi.fn().mockResolvedValue(undefined);
let board: QueueBoard | null = null;
// A constant: the page refetches table occupancy whenever this changes.
const UPDATED_AT = 1_757_000_000_000;

vi.mock('@/lib/queue/use-queue-board', () => ({
  useQueueBoard: (ctx: unknown) => ({
    board: ctx ? board : null,
    loading: false,
    error: null,
    stream: 'open',
    updatedAt: UPDATED_AT,
    refresh,
  }),
}));

const queueMock = vi.hoisted(() => ({
  seat: vi.fn(),
  assignTable: vi.fn(),
  releaseTable: vi.fn(),
  tableAvailability: vi.fn(),
}));
vi.mock('@/lib/queue/api', () => ({
  queueApi: new Proxy(queueMock, {
    get: (t, k: string) => (...a: unknown[]) => (t as Record<string, (...x: unknown[]) => unknown>)[k](...a),
  }),
}));

const createTable = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin/api', () => ({ adminApi: { createTable: (...a: unknown[]) => createTable(...a) } }));

const logout = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => ({ logout }) }));

vi.mock('@/components/shell/branch-chip', () => ({ BranchChip: () => null }));

const auditLogs = vi.hoisted(() => vi.fn());
vi.mock('@/lib/settings/api', () => ({ settingsApi: { auditLogs: (...a: unknown[]) => auditLogs(...a) } }));

let branchPermissions: string[] = [];
let companyPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    selectedBranch: { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

import QueueTablesPage from './(staff)/(app)/queue/tables/page';
import { RecordHistory } from '@/components/audit/record-history';

const CTX = { companyId: 'co-1', branchId: 'br-1' };

const token = (over: Partial<QueueToken> = {}): QueueToken => ({
  id: 't-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  customer_id: null,
  customer: null,
  service_date: '2026-09-07',
  token_number: 1,
  status: 'CALLED',
  adults: 2,
  kids: 0,
  party_size: 2,
  advance_booking_at: null,
  assigned_table_id: null,
  assigned_table: null,
  called_at: '2026-09-07T10:05:00.000Z',
  seated_at: null,
  cancelled_at: null,
  no_show_at: null,
  skipped_at: null,
  skip_count: 0,
  created_at: '2026-09-07T10:00:00.000Z',
  updated_at: '2026-09-07T10:00:00.000Z',
  ...over,
});

const table = (id: string, label: string, capacity: number, over: Record<string, unknown> = {}) => ({
  id,
  label,
  capacity,
  zone: null,
  status: 'ACTIVE' as const,
  occupied_by: null,
  ...over,
});

describe('Waiter — table management', () => {
  beforeEach(() => {
    for (const fn of Object.values(queueMock)) fn.mockReset();
    createTable.mockReset();
    logout.mockReset();
    refresh.mockReset().mockResolvedValue(undefined);
    branchPermissions = ['queue.view', 'queue.seat'];
    companyPermissions = [];
    const seated = token({
      id: 's-1',
      token_number: 3,
      status: 'SEATED',
      party_size: 4,
      assigned_table_id: 'tbl-1',
      assigned_table: { id: 'tbl-1', label: 'T1' },
      seated_at: '2026-09-07T10:20:00.000Z',
    });
    board = {
      branch_id: 'br-1',
      service_date: '2026-09-07',
      next_token_number: 8,
      counts: { scheduled: 0, waiting: 0, called: 1, seated: 1, no_show: 0, cancelled: 0 },
      totals: { parties: 0, adults: 0, kids: 0 },
      next_waiting: null,
      scheduled: [],
      waiting: [token({ id: 'w-1', token_number: 11, status: 'WAITING' }), token({ id: 'w-2', token_number: 12, status: 'WAITING' })],
      called: [token({ id: 'c-1', token_number: 7, party_size: 6 })],
      // Seated in a hurry, with no table yet: a different job from seating a
      // called party, and shown in its own section.
      seated: [seated, token({ id: 's-2', token_number: 9, status: 'SEATED', party_size: 2, seated_at: '2026-09-07T10:30:00.000Z' })],
    };
    queueMock.tableAvailability.mockResolvedValue([
      table('tbl-1', 'T1', 4, { occupied_by: { token_id: 's-1', token_number: 3, service_date: '2026-09-07' } }),
      table('tbl-2', 'T2', 4),
      table('tbl-3', 'T3', 2, { occupied_by: { token_id: 'old-1', token_number: 40, service_date: '2026-09-06' } }),
      table('tbl-4', 'T4', 8, { status: 'INACTIVE' }),
    ]);
    queueMock.seat.mockResolvedValue(token({ id: 'c-1', token_number: 7, status: 'SEATED', assigned_table: { id: 'tbl-2', label: 'T2' } }));
    queueMock.releaseTable.mockResolvedValue(token({ id: 's-1', token_number: 3, status: 'SEATED' }));
  });

  it('is refused without queue.seat and asks the API for nothing', () => {
    branchPermissions = ['queue.view'];
    render(<QueueTablesPage />);
    expect(screen.getByRole('alert').textContent).toMatch('You do not have permission to seat guests');
    expect(queueMock.tableAvailability).not.toHaveBeenCalled();
  });

  it('is headed Table Management and signs the waiter out from the header', async () => {
    render(<QueueTablesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Table Management' })).toBeTruthy();
    expect(screen.getByText('Waiter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
    await screen.findByRole('list', { name: 'Available tables' });
  });

  it('separates available, occupied and out-of-service tables, with counts', async () => {
    render(<QueueTablesPage />);
    const available = await screen.findByRole('list', { name: 'Available tables' });
    expect(within(available).getAllByRole('listitem').map((l) => l.getAttribute('aria-label'))).toEqual(['Table T2']);
    expect(within(available).getByText('Free')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Available Tables' }).parentElement!.textContent).toMatch(/1$/);

    const occupied = screen.getByRole('list', { name: 'Occupied tables' });
    const t1 = within(occupied).getByRole('listitem', { name: 'Table T1' });
    expect(within(t1).getByText(/Token 3 · 4 guests · seated/)).toBeTruthy();
    expect(within(within(occupied).getByRole('listitem', { name: 'Table T3' })).getByText(/earlier service date/)).toBeTruthy();

    const t4 = within(screen.getByRole('list', { name: 'Out of service tables' })).getByRole('listitem', { name: 'Table T4' });
    expect(within(t4).getByText('Out of service')).toBeTruthy();
    expect(within(t4).queryByRole('button')).toBeNull();
  });

  it('seats a called party at a free table, and warns when the party is larger than the table', async () => {
    render(<QueueTablesPage />);
    const ready = await screen.findByRole('list', { name: 'Ready to Seat' });
    const party = within(ready).getByRole('listitem', { name: 'Token 7' });
    expect(within(party).getByRole('button', { name: 'Seat' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(party).getByLabelText('Table for token 7'), { target: { value: 'tbl-2' } });
    expect(within(party).getByText(/party of 6 is more than table T2’s 4 seats/)).toBeTruthy();
    fireEvent.click(within(party).getByRole('button', { name: 'Seat' }));
    await waitFor(() => expect(queueMock.seat).toHaveBeenCalledWith(CTX, 'c-1', 'tbl-2'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('names the two seating jobs apart, and says who is still waiting at the podium', async () => {
    render(<QueueTablesPage />);
    const ready = await screen.findByRole('list', { name: 'Ready to Seat' });
    expect(within(ready).getAllByRole('listitem').map((l) => l.getAttribute('aria-label'))).toEqual(['Token 7']);
    expect(within(ready).getByRole('button', { name: 'Seat' })).toBeTruthy();

    // A party already seated is NOT waiting; it needs a table, not a seat.
    const noTable = screen.getByRole('list', { name: 'Seated Without a Table' });
    expect(within(noTable).getAllByRole('listitem').map((l) => l.getAttribute('aria-label'))).toEqual(['Token 9']);
    expect(within(noTable).getByRole('button', { name: 'Assign table' })).toBeTruthy();

    // The parties the podium has yet to call cannot be seated at all, so they
    // are counted, not listed with a dead button.
    expect(screen.getByText(/waiting to be\s+called at the podium/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Customers waiting' })).toBeNull();
  });


  it('assigns a table to a party seated without one', async () => {
    queueMock.assignTable.mockResolvedValue(token({ id: 's-2', token_number: 9, status: 'SEATED' }));
    render(<QueueTablesPage />);
    const noTable = await screen.findByRole('list', { name: 'Seated Without a Table' });
    fireEvent.change(within(noTable).getByLabelText('Table for token 9'), { target: { value: 'tbl-2' } });
    fireEvent.click(within(noTable).getByRole('button', { name: 'Assign table' }));
    await waitFor(() => expect(queueMock.assignTable).toHaveBeenCalledWith(CTX, 's-2', 'tbl-2'));
  });

  it('only offers tables that are free', async () => {
    render(<QueueTablesPage />);
    const select = await screen.findByLabelText('Table for token 7');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a table', 'Table T2 · 4 seats']);
  });

  it('clears a table for today’s party and for one left from an earlier date', async () => {
    render(<QueueTablesPage />);
    const occupied = await screen.findByRole('list', { name: 'Occupied tables' });
    fireEvent.click(within(within(occupied).getByRole('listitem', { name: 'Table T1' })).getByRole('button', { name: 'Table cleared' }));
    await waitFor(() => expect(queueMock.releaseTable).toHaveBeenCalledWith(CTX, 's-1'));

    fireEvent.click(within(within(occupied).getByRole('listitem', { name: 'Table T3' })).getByRole('button', { name: 'Table cleared' }));
    await waitFor(() => expect(queueMock.releaseTable).toHaveBeenCalledWith(CTX, 'old-1'));
  });

  it('shows a refusal from the server instead of pretending the seat worked', async () => {
    queueMock.seat.mockRejectedValue(new Error('Table is already occupied'));
    render(<QueueTablesPage />);
    fireEvent.change(await screen.findByLabelText('Table for token 7'), { target: { value: 'tbl-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Seat' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('Table is already occupied');
  });

  it('adds a table with tables.create and reloads the floor', async () => {
    branchPermissions = ['queue.view', 'queue.seat', 'tables.create'];
    createTable.mockResolvedValue({ id: 'tbl-9', label: 'T9', capacity: 6 });
    render(<QueueTablesPage />);
    await waitFor(() => expect(queueMock.tableAvailability).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Table Number'), { target: { value: ' T9 ' } });
    fireEvent.change(screen.getByLabelText('Seating Capacity'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTable).toHaveBeenCalledWith('co-1', 'br-1', { label: 'T9', capacity: 6 }));
    expect((await screen.findByText('Table T9 added.')).getAttribute('role')).toBe('status');
    await waitFor(() => expect(queueMock.tableAvailability).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Table Number') as HTMLInputElement).value).toBe('');
  });

  it('checks the new table before asking the server, and shows the server’s refusal', async () => {
    branchPermissions = ['queue.view', 'queue.seat', 'tables.create'];
    render(<QueueTablesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a table number.');

    fireEvent.change(screen.getByLabelText('Table Number'), { target: { value: 'T9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter how many guests the table seats.');
    expect(createTable).not.toHaveBeenCalled();

    createTable.mockRejectedValue(new Error('A table with this label already exists'));
    fireEvent.change(screen.getByLabelText('Seating Capacity'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A table with this label already exists');
  });

  it('offers no Add New Table without tables.create', async () => {
    render(<QueueTablesPage />);
    await screen.findByRole('list', { name: 'Available tables' });
    expect(screen.queryByRole('heading', { name: 'Add New Table' })).toBeNull();
  });
});

describe('Record history', () => {
  const open = (container: HTMLElement) => {
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
  };

  beforeEach(() => {
    auditLogs.mockReset();
    companyPermissions = ['audit_logs.view'];
  });

  it('renders nothing without audit_logs.view', () => {
    companyPermissions = [];
    const { container } = render(<RecordHistory entityType="TASK" entityId="task-1" />);
    expect(container.innerHTML).toBe('');
    expect(auditLogs).not.toHaveBeenCalled();
  });

  it('loads only when opened, filtered to this one record, and says what changed', async () => {
    auditLogs.mockResolvedValue({
      data: [
        {
          id: 'a-1',
          created_at: '2026-09-07T10:00:00.000Z',
          event_type: 'UPDATE',
          entity_type: 'BANQUET_BOOKING',
          entity_id: 'bk-1',
          payload: { action: 'discount_changed', changes: { discount_minor: { from: 0, to: 5000 } } },
          user: { id: 'u-1', email: 'meera@test', first_name: 'Meera', last_name: 'Nair' },
          branch: { id: 'br-1', name: 'Alpha Main' },
        },
      ],
      meta: { total: 1, limit: 50, offset: 0 },
    });
    const { container } = render(<RecordHistory entityType="BANQUET_BOOKING" entityId="bk-1" />);
    expect(auditLogs).not.toHaveBeenCalled();

    open(container);
    await waitFor(() =>
      expect(auditLogs).toHaveBeenCalledWith('co-1', { entity_type: 'BANQUET_BOOKING', entity_id: 'bk-1', limit: 50, offset: 0 }),
    );
    const list = await screen.findByRole('list', { name: 'Change history' });
    expect(list.textContent).toMatch('Meera Nair');
    expect(list.textContent).toMatch('discount changed — discount minor: 0 → 5000');
  });

  it('says so when the record has no recorded changes, and surfaces a failure', async () => {
    auditLogs.mockResolvedValueOnce({ data: [], meta: { total: 0, limit: 50, offset: 0 } });
    const first = render(<RecordHistory entityType="TASK" entityId="task-1" />);
    open(first.container);
    expect(await screen.findByText('No recorded changes.')).toBeTruthy();
    first.unmount();

    auditLogs.mockRejectedValueOnce(new Error('Forbidden'));
    const second = render(<RecordHistory entityType="TASK" entityId="task-2" />);
    open(second.container);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
  });
});

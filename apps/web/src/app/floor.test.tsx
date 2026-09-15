import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QueueBoard, QueueToken } from '@/lib/queue/types';

/**
 * The waiter's floor view (/queue/tables) and the per-record history panel.
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

describe('Tables — the waiter floor view', () => {
  beforeEach(() => {
    for (const fn of Object.values(queueMock)) fn.mockReset();
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
      counts: { scheduled: 0, waiting: 0, called: 1, seated: 1, no_show: 0, cancelled: 0 },
      totals: { parties: 0, adults: 0, kids: 0 },
      next_waiting: null,
      scheduled: [],
      waiting: [],
      called: [token({ id: 'c-1', token_number: 7, party_size: 6 })],
      seated: [seated],
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

  it('shows each table free, occupied or out of service', async () => {
    render(<QueueTablesPage />);
    const floor = await screen.findByRole('list', { name: 'Floor' });
    const t1 = within(floor).getByRole('listitem', { name: 'Table T1' });
    expect(within(t1).getByText('Occupied')).toBeTruthy();
    expect(within(t1).getByText(/Token 3 · 4 guests · seated/)).toBeTruthy();
    expect(within(within(floor).getByRole('listitem', { name: 'Table T2' })).getByText('Free')).toBeTruthy();
    expect(within(within(floor).getByRole('listitem', { name: 'Table T3' })).getByText(/earlier service date/)).toBeTruthy();
    const t4 = within(floor).getByRole('listitem', { name: 'Table T4' });
    expect(within(t4).getByText('Out of service')).toBeTruthy();
    expect(within(t4).queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Table totals').textContent).toMatch('1 of 3 tables free');
  });

  it('seats a called party at a free table, and warns when the party is larger than the table', async () => {
    render(<QueueTablesPage />);
    const t2 = await screen.findByRole('listitem', { name: 'Table T2' });
    fireEvent.change(within(t2).getByLabelText('Party for table T2'), { target: { value: 'c-1' } });
    expect(within(t2).getByText(/party of 6 is more than this table’s 4 seats/)).toBeTruthy();
    fireEvent.click(within(t2).getByRole('button', { name: 'Seat here' }));
    await waitFor(() => expect(queueMock.seat).toHaveBeenCalledWith(CTX, 'c-1', 'tbl-2'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('clears a table for today’s party and for one left from an earlier date', async () => {
    render(<QueueTablesPage />);
    const t1 = await screen.findByRole('listitem', { name: 'Table T1' });
    fireEvent.click(within(t1).getByRole('button', { name: 'Table cleared' }));
    await waitFor(() => expect(queueMock.releaseTable).toHaveBeenCalledWith(CTX, 's-1'));

    const t3 = screen.getByRole('listitem', { name: 'Table T3' });
    fireEvent.click(within(t3).getByRole('button', { name: 'Table cleared' }));
    await waitFor(() => expect(queueMock.releaseTable).toHaveBeenCalledWith(CTX, 'old-1'));
  });

  it('shows a refusal from the server instead of pretending the seat worked', async () => {
    queueMock.seat.mockRejectedValue(new Error('Table is already occupied'));
    render(<QueueTablesPage />);
    const t2 = await screen.findByRole('listitem', { name: 'Table T2' });
    fireEvent.change(within(t2).getByLabelText('Party for table T2'), { target: { value: 'c-1' } });
    fireEvent.click(within(t2).getByRole('button', { name: 'Seat here' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('Table is already occupied');
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

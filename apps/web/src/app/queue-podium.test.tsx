import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { QueueBoard, QueueToken } from '@/lib/queue/types';

const refresh = vi.fn().mockResolvedValue(undefined);
let board: QueueBoard | null = null;
let stream: string = 'open';

vi.mock('@/lib/queue/use-queue-board', () => ({
  useQueueBoard: () => ({
    board,
    loading: false,
    error: null,
    stream,
    updatedAt: Date.now(),
    refresh,
  }),
}));

const call = vi.fn();
const seat = vi.fn();
const noShow = vi.fn();
const cancel = vi.fn();
const assignTable = vi.fn();
const releaseTable = vi.fn();
const tables = vi.fn();

vi.mock('@/lib/queue/api', () => ({
  queueApi: {
    call: (...a: unknown[]) => call(...a),
    seat: (...a: unknown[]) => seat(...a),
    noShow: (...a: unknown[]) => noShow(...a),
    cancel: (...a: unknown[]) => cancel(...a),
    assignTable: (...a: unknown[]) => assignTable(...a),
    releaseTable: (...a: unknown[]) => releaseTable(...a),
    tables: (...a: unknown[]) => tables(...a),
  },
}));

let branchPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    companyPermissions: [],
    branchPermissions,
    loading: false,
  }),
}));

import PodiumPage from './(staff)/(app)/queue/podium/page';

const token = (over: Partial<QueueToken> = {}): QueueToken => ({
  id: 't-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  customer_id: null,
  customer: null,
  service_date: '2026-09-07',
  token_number: 1,
  status: 'WAITING',
  party_size: 2,
  assigned_table_id: null,
  assigned_table: null,
  called_at: null,
  seated_at: null,
  cancelled_at: null,
  no_show_at: null,
  created_at: '2026-09-07T10:00:00.000Z',
  updated_at: '2026-09-07T10:00:00.000Z',
  ...over,
});

const makeBoard = (over: Partial<QueueBoard> = {}): QueueBoard => ({
  branch_id: 'br-1',
  service_date: '2026-09-07',
  counts: { waiting: 1, called: 1, seated: 0, no_show: 0, cancelled: 0 },
  next_waiting: token({ id: 'w-1', token_number: 5, customer: { id: 'c-1', name: 'Asha Rao' } }),
  waiting: [token({ id: 'w-1', token_number: 5, customer: { id: 'c-1', name: 'Asha Rao' } })],
  called: [token({ id: 'c-1', token_number: 4, status: 'CALLED', called_at: '2026-09-07T10:05:00.000Z' })],
  seated: [],
  ...over,
});

const ALL = ['queue.view', 'queue.call', 'queue.seat', 'queue.no_show', 'queue.cancel', 'tables.view'];

describe('Podium operator', () => {
  beforeEach(() => {
    for (const m of [call, seat, noShow, cancel, assignTable, releaseTable, refresh]) m.mockReset();
    refresh.mockResolvedValue(undefined);
    call.mockResolvedValue(token({ status: 'CALLED', token_number: 5 }));
    seat.mockResolvedValue(token({ status: 'SEATED', token_number: 4 }));
    noShow.mockResolvedValue(token({ status: 'NO_SHOW', token_number: 4 }));
    cancel.mockResolvedValue(token({ status: 'CANCELLED', token_number: 5 }));
    releaseTable.mockResolvedValue(token({ status: 'SEATED', token_number: 4 }));
    tables.mockResolvedValue({
      data: [
        { id: 'tbl-1', branch_id: 'br-1', label: 'T1', capacity: 4, zone: null, status: 'ACTIVE' },
        { id: 'tbl-2', branch_id: 'br-1', label: 'T2', capacity: 2, zone: null, status: 'ACTIVE' },
      ],
      meta: { total: 2, limit: 100, offset: 0 },
    });
    branchPermissions = [...ALL];
    board = makeBoard();
    stream = 'open';
  });

  it('makes the next party unmissable and calls it', async () => {
    render(<PodiumPage />);
    const next = screen.getByLabelText('Next party');
    expect(within(next).getByText('5')).toBeTruthy();
    expect(within(next).getByText('Asha Rao')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'w-1'));
  });

  it('reconciles with the server after every action — a request is not a result', async () => {
    render(<PodiumPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('still refetches when an action FAILS, so the operator sees the real state', async () => {
    call.mockRejectedValue(Object.assign(new Error('Cannot move a queue token from CALLED to CALLED'), {}));
    render(<PodiumPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/Cannot move a queue token/);
  });

  it('seats a called party, with a table when one is chosen', async () => {
    render(<PodiumPage />);
    await waitFor(() => expect(tables).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText('Table for token 4'), { target: { value: 'tbl-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Seat at table' }));

    await waitFor(() =>
      expect(seat).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'c-1', 'tbl-2'),
    );
  });

  it('seats without a table when none is chosen', async () => {
    render(<PodiumPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Seat' }));
    await waitFor(() =>
      expect(seat).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'c-1', undefined),
    );
  });

  it('marks a no show and cancels', async () => {
    render(<PodiumPage />);
    fireEvent.click(screen.getByRole('button', { name: 'No show' }));
    await waitFor(() => expect(noShow).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('offers table release only for a seated party that holds one', async () => {
    board = makeBoard({
      called: [],
      seated: [
        token({
          id: 's-1',
          token_number: 3,
          status: 'SEATED',
          seated_at: '2026-09-07T10:10:00.000Z',
          assigned_table_id: 'tbl-1',
          assigned_table: { id: 'tbl-1', label: 'T1' },
        }),
      ],
      counts: { waiting: 1, called: 0, seated: 1, no_show: 0, cancelled: 0 },
    });
    render(<PodiumPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Release table' }));
    await waitFor(() => expect(releaseTable).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 's-1'));
  });

  it('does not offer a table already held by a seated party', async () => {
    board = makeBoard({
      seated: [
        token({
          id: 's-1',
          token_number: 3,
          status: 'SEATED',
          assigned_table_id: 'tbl-1',
          assigned_table: { id: 'tbl-1', label: 'T1' },
        }),
      ],
    });
    render(<PodiumPage />);

    const select = await screen.findByLabelText('Table for token 4');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.includes('T2'))).toBe(true);
    expect(options.some((o) => o?.includes('T1'))).toBe(false);
  });

  it('hides actions the viewer has no permission for', () => {
    branchPermissions = ['queue.view'];
    render(<PodiumPage />);
    expect(screen.queryByRole('button', { name: /^Call/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('says so plainly when nobody is waiting', () => {
    board = makeBoard({
      waiting: [],
      next_waiting: null,
      counts: { waiting: 0, called: 1, seated: 0, no_show: 0, cancelled: 0 },
    });
    render(<PodiumPage />);
    expect(screen.getByText('Nobody is waiting.')).toBeTruthy();
  });

  it('shows the live connection state and keeps a manual refresh available', () => {
    stream = 'reconnecting';
    render(<PodiumPage />);
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalled();
  });
});

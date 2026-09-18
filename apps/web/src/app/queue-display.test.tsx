import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { QueueBoard, QueueToken } from '@/lib/queue/types';

const refresh = vi.fn().mockResolvedValue(undefined);
const boardCtx = vi.fn();
let board: QueueBoard | null = null;
let stream = 'open';

vi.mock('@/lib/queue/use-queue-board', () => ({
  useQueueBoard: (ctx: unknown) => {
    boardCtx(ctx);
    return { board: ctx ? board : null, loading: false, error: null, stream, updatedAt: 1, refresh };
  },
}));

vi.mock('@/components/shell/branch-chip', () => ({ BranchChip: () => null }));

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

import CustomerDisplayPage from './(staff)/(app)/queue/display/page';

const token = (over: Partial<QueueToken> = {}): QueueToken => ({
  id: 't-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  customer_id: null,
  customer: null,
  service_date: '2026-09-07',
  token_number: 1,
  status: 'WAITING',
  adults: 2,
  kids: 0,
  party_size: 2,
  advance_booking_at: null,
  assigned_table_id: null,
  assigned_table: null,
  called_at: null,
  seated_at: null,
  cancelled_at: null,
  no_show_at: null,
  skipped_at: null,
  skip_count: 0,
  created_at: '2026-09-07T10:00:00.000Z',
  updated_at: '2026-09-07T10:00:00.000Z',
  ...over,
});

const empty = (): QueueBoard => ({
  branch_id: 'br-1',
  service_date: '2026-09-07',
  next_token_number: 1,
  counts: { scheduled: 0, waiting: 0, called: 0, seated: 0, no_show: 0, cancelled: 0 },
  totals: { parties: 0, adults: 0, kids: 0 },
  next_waiting: null,
  scheduled: [],
  waiting: [],
  called: [],
  seated: [],
});

describe('Customer Display', () => {
  beforeEach(() => {
    refresh.mockClear();
    boardCtx.mockClear();
    branchPermissions = ['queue.view'];
    stream = 'open';
    board = {
      ...empty(),
      called: [
        token({ id: 'c-1', token_number: 4, status: 'CALLED', customer_id: 'cu-1', customer: { id: 'cu-1', name: 'Asha Rao' } }),
        token({ id: 'c-2', token_number: 6, status: 'CALLED', assigned_table_id: 'tb-1', assigned_table: { id: 'tb-1', label: 'T3' } }),
      ],
      waiting: [token({ id: 'w-1', token_number: 7, customer: { id: 'cu-2', name: 'Bo Chen' } }), token({ id: 'w-2', token_number: 9 })],
    };
  });

  afterEach(() => {
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it('shows who is being served, with their table or the podium, and the waiting numbers', () => {
    render(<CustomerDisplayPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Customer Display' })).toBeTruthy();

    const serving = screen.getByRole('heading', { name: 'Now Serving' }).closest('section')!;
    expect(within(serving).getByLabelText('Token 4').textContent).toMatch(/4\s*Please come to the podium/);
    expect(within(serving).getByLabelText('Token 6').textContent).toMatch(/6\s*Table T3/);
    expect(serving.textContent).toMatch(/Now Serving\s*2/);

    const waiting = screen.getByRole('heading', { name: 'Waiting' }).closest('section')!;
    expect(within(waiting).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['7', '9']);
  });

  it('never shows a customer name — the screen faces the room', () => {
    const { container } = render(<CustomerDisplayPage />);
    expect(container.textContent).not.toMatch(/Asha Rao|Bo Chen/);
  });

  it('says so when nobody is being served or waiting', () => {
    board = empty();
    render(<CustomerDisplayPage />);
    expect(screen.getByText('No customers being served')).toBeTruthy();
    expect(screen.getByText('No customers waiting')).toBeTruthy();
  });

  it('has no QR codes or booking links', () => {
    render(<CustomerDisplayPage />);
    expect(screen.queryByText(/QR/i)).toBeNull();
    expect(screen.queryByRole('img', { name: /QR/i })).toBeNull();
  });

  it('goes full screen on request where the browser supports it', () => {
    const request = vi.fn().mockResolvedValue(undefined);
    (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen = request;
    render(<CustomerDisplayPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(request).toHaveBeenCalled();
  });

  it('offers no full screen button where the browser cannot do it', () => {
    render(<CustomerDisplayPage />);
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  it('shows the connection state and a refresh while not live', () => {
    stream = 'reconnecting';
    render(<CustomerDisplayPage />);
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('is refused without queue.view and asks for no board', () => {
    branchPermissions = ['queue.seat'];
    render(<CustomerDisplayPage />);
    expect(screen.getByRole('alert').textContent).toMatch(/do not have permission to view the queue/);
    expect(boardCtx).toHaveBeenCalledWith(null);
  });
});

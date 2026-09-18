import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { QueueBoard, QueueToken } from '@/lib/queue/types';

const refresh = vi.fn().mockResolvedValue(undefined);
let board: QueueBoard | null = null;
let boardError: string | null = null;

vi.mock('@/lib/queue/use-queue-board', () => ({
  useQueueBoard: () => ({
    board,
    loading: false,
    error: boardError,
    stream: 'open',
    updatedAt: Date.now(),
    refresh,
  }),
}));

const cancel = vi.fn();
vi.mock('@/lib/queue/api', () => ({
  queueApi: { cancel: (...a: unknown[]) => cancel(...a) },
}));

// The pill reads the full context; it has its own tests (app-shell.test).
vi.mock('@/components/shell/branch-chip', () => ({ BranchChip: () => null }));

let branchPermissions: string[] = [];
let selectedBranchId: string | null = 'br-1';
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId,
    companyPermissions: [],
    branchPermissions,
    loading: false,
  }),
}));

let pathname = '/queue';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import QueuePage from './(staff)/(app)/queue/page';
import QueueLayout from './(staff)/(app)/queue/layout';

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

const emptyBoard = (): QueueBoard => ({
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

describe('Admin Display — queue management', () => {
  beforeEach(() => {
    refresh.mockClear();
    cancel.mockReset().mockResolvedValue(token({ status: 'CANCELLED' }));
    branchPermissions = ['queue.view', 'queue.cancel'];
    selectedBranchId = 'br-1';
    pathname = '/queue';
    boardError = null;
    board = {
      ...emptyBoard(),
      next_token_number: 6,
      counts: { scheduled: 0, waiting: 1, called: 1, seated: 1, no_show: 2, cancelled: 3 },
      totals: { parties: 3, adults: 7, kids: 2 },
      next_waiting: token({ id: 'w-1', token_number: 5 }),
      waiting: [token({ id: 'w-1', token_number: 5, customer: { id: 'c-1', name: 'Asha Rao' } })],
      called: [token({ id: 'c-9', token_number: 4, status: 'CALLED', called_at: '2026-09-07T10:05:00.000Z' })],
      seated: [
        token({
          id: 's-9',
          token_number: 3,
          status: 'SEATED',
          seated_at: '2026-09-07T10:07:00.000Z',
          assigned_table_id: 'tbl-1',
          assigned_table: { id: 'tbl-1', label: 'T1' },
        }),
      ],
    };
  });

  it('is headed Queue Management, with a way back home', () => {
    render(<QueuePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Queue Management' })).toBeTruthy();
    expect(screen.getByText('Admin Display')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });

  it('shows total waiting, adults and kids from the board', () => {
    render(<QueuePage />);
    const tiles = within(screen.getByRole('list', { name: 'Queue totals' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual(['3Total Waiting', '7Total Adults', '2Total Kids']);
  });

  it('lists the live parties and the day counts', () => {
    render(<QueuePage />);
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Called' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Seated' })).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Table T1')).toBeTruthy();
    expect(screen.getByText('2026-09-07')).toBeTruthy();
    expect(screen.queryByText('No customers yet')).toBeNull();
  });

  it('says the queue is empty when nobody is in it', () => {
    board = emptyBoard();
    render(<QueuePage />);
    expect(screen.getByRole('heading', { name: 'No customers yet' })).toBeTruthy();
    expect(screen.getByText('The queue is currently empty')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Waiting' })).toBeNull();
  });

  it('shows advance bookings in their own section, only when there are any', () => {
    render(<QueuePage />);
    expect(screen.queryByRole('heading', { name: 'Scheduled' })).toBeNull();

    board = {
      ...board!,
      counts: { ...board!.counts, scheduled: 1 },
      scheduled: [token({ id: 'sc-1', token_number: 8, status: 'SCHEDULED', advance_booking_at: '2026-09-07T13:30:00.000Z' })],
    };
    render(<QueuePage />);
    expect(screen.getByRole('heading', { name: 'Scheduled' })).toBeTruthy();
    expect(screen.getByText(/Booked for/)).toBeTruthy();
  });

  it('labels a party with no customer as a walk-in', () => {
    render(<QueuePage />);
    expect(screen.getAllByText('Walk-in').length).toBeGreaterThan(0);
  });

  it('offers cancel where permitted and nothing else — this view is not the podium', () => {
    render(<QueuePage />);
    expect(screen.queryByRole('button', { name: /^Call/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seat' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBe(2); // waiting + called
  });

  it('hides cancel without the permission', () => {
    branchPermissions = ['queue.view'];
    render(<QueuePage />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('reconciles after cancelling', async () => {
    render(<QueuePage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('offers a retry when the board cannot be loaded at all', () => {
    board = null;
    boardError = 'Network unreachable';
    render(<QueuePage />);
    expect(screen.getByRole('alert').textContent).toMatch(/Network unreachable/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('Queue tab bar', () => {
  const renderLayout = () =>
    render(
      <QueueLayout>
        <p>child</p>
      </QueueLayout>,
    );
  const tabs = () =>
    within(screen.getByRole('navigation', { name: 'Queue sections' }))
      .getAllByRole('link')
      .map((l) => l.textContent);

  beforeEach(() => {
    selectedBranchId = 'br-1';
    pathname = '/queue';
    branchPermissions = ['queue.view', 'queue.register', 'queue.call'];
  });

  it('asks for a branch before showing any queue screen', () => {
    selectedBranchId = null;
    renderLayout();
    expect(screen.getByText(/Select a branch/)).toBeTruthy();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('shows Home and one tab per permitted screen, marking the current one', () => {
    renderLayout();
    expect(tabs()).toEqual(['Home', 'Display', 'Podium', 'Register', 'Customer']);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Display' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Podium' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('marks a nested screen as current, not the Admin Display', () => {
    pathname = '/queue/display';
    renderLayout();
    expect(screen.getByRole('link', { name: 'Customer' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Display' }).getAttribute('aria-current')).toBeNull();
  });

  it('drops the screens the viewer has no permission for', () => {
    branchPermissions = ['queue.view'];
    renderLayout();
    expect(tabs()).toEqual(['Home', 'Display', 'Customer']);

    branchPermissions = ['queue.seat'];
    renderLayout();
    expect(screen.getAllByRole('navigation', { name: 'Queue sections' }).length).toBe(2);
    expect(screen.getAllByRole('link', { name: 'Waiter' })[0].getAttribute('href')).toBe('/queue/tables');
  });

  it('renders no tab bar for someone with no queue permission, leaving the page to show the refusal', () => {
    branchPermissions = ['tables.view'];
    renderLayout();
    expect(screen.queryByRole('navigation', { name: 'Queue sections' })).toBeNull();
    expect(screen.getByText('child')).toBeTruthy();
  });
});

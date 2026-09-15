import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('Queue management view', () => {
  beforeEach(() => {
    refresh.mockClear();
    cancel.mockReset().mockResolvedValue(token({ status: 'CANCELLED' }));
    branchPermissions = ['queue.view', 'queue.cancel'];
    selectedBranchId = 'br-1';
    pathname = '/queue';
    boardError = null;
    board = {
      branch_id: 'br-1',
      service_date: '2026-09-07',
      counts: { scheduled: 0, waiting: 1, called: 1, seated: 1, no_show: 2, cancelled: 3 },
      totals: { parties: 1, adults: 2, kids: 0 },
      next_waiting: token({ id: 'w-1', token_number: 5 }),
      scheduled: [],
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

  it('shows the three lists and the day counts', () => {
    render(<QueuePage />);
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Called' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Seated' })).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Table T1')).toBeTruthy();
    expect(screen.getByText('2026-09-07')).toBeTruthy();
  });

  it('shows advance bookings in their own section, only when there are any', () => {
    render(<QueuePage />);
    expect(screen.queryByRole('heading', { name: 'Scheduled' })).toBeNull();
  });

  it('lists a scheduled booking with its time', () => {
    board = {
      ...board!,
      counts: { ...board!.counts, scheduled: 1 },
      scheduled: [token({ id: 'sc-1', token_number: 8, status: 'SCHEDULED', advance_booking_at: '2026-09-07T13:30:00.000Z' })],
    };
    render(<QueuePage />);
    expect(screen.getByRole('heading', { name: 'Scheduled' })).toBeTruthy();
    expect(screen.getByText(/Booked for/)).toBeTruthy();
    // The count is split across <strong>1</strong> and " scheduled".
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && /^1\s*scheduled$/.test(el.textContent ?? '')),
    ).toBeTruthy();
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

describe('Queue sub-navigation', () => {
  beforeEach(() => {
    selectedBranchId = 'br-1';
    pathname = '/queue';
    branchPermissions = ['queue.view', 'queue.register', 'queue.call'];
  });

  it('asks for a branch before showing any queue surface', () => {
    selectedBranchId = null;
    render(
      <QueueLayout>
        <p>child</p>
      </QueueLayout>,
    );
    expect(screen.getByText(/Select a branch/)).toBeTruthy();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('shows one link per permitted surface and marks the current one', () => {
    render(
      <QueueLayout>
        <p>child</p>
      </QueueLayout>,
    );
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links).toEqual(['Queue', 'Register', 'Podium']);
    expect(screen.getByRole('link', { name: 'Queue' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('drops the surfaces the viewer has no permission for', () => {
    branchPermissions = ['queue.view'];
    render(
      <QueueLayout>
        <p>child</p>
      </QueueLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Queue']);
  });
});

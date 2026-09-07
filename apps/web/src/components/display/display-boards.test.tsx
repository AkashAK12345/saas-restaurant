import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CustomerQueueBoard } from './customer-queue-board';
import { AdminQueueBoard } from './admin-queue-board';
import { PairingForm } from './pairing-form';
import type { QueueAdminBoard, QueueCustomerBoard, QueueTokenPublic } from '@/lib/queue/types';

const customerBoard: QueueCustomerBoard = {
  branch_id: 'br-1',
  service_date: '2026-09-07',
  now_serving: [
    { token_number: 12, table_label: 'T4', called_at: '2026-09-07T10:05:00.000Z' },
    { token_number: 13, table_label: null, called_at: '2026-09-07T10:07:00.000Z' },
  ],
  recently_seated: [{ token_number: 11, table_label: 'T1', called_at: null }],
  waiting_count: 6,
};

const publicToken = (over: Partial<QueueTokenPublic> = {}): QueueTokenPublic => ({
  id: 'p-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  customer_id: 'c-1',
  service_date: '2026-09-07',
  token_number: 7,
  status: 'WAITING',
  party_size: 4,
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

const adminBoard: QueueAdminBoard = {
  branch_id: 'br-1',
  service_date: '2026-09-07',
  counts: { waiting: 1, called: 1, seated: 1, no_show: 2, cancelled: 3 },
  waiting: [publicToken()],
  called: [publicToken({ id: 'p-2', token_number: 8, status: 'CALLED', called_at: '2026-09-07T10:05:00.000Z' })],
  seated: [
    publicToken({
      id: 'p-3',
      token_number: 9,
      status: 'SEATED',
      seated_at: '2026-09-07T10:09:00.000Z',
      assigned_table_id: 'tbl-1',
      assigned_table: { id: 'tbl-1', label: 'T9' },
    }),
  ],
};

describe('CustomerQueueBoard', () => {
  it('shows the numbers being served and where to go', () => {
    render(<CustomerQueueBoard board={customerBoard} branchName="Alpha Main" stream="open" />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Table T4')).toBeTruthy();
    // A called party with no table is told where to go instead.
    expect(screen.getByText('Please come to the podium')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('shows a waiting message when nobody has been called', () => {
    render(
      <CustomerQueueBoard
        board={{ ...customerBoard, now_serving: [] }}
        stream="open"
      />,
    );
    expect(screen.getByText('Please wait to be called')).toBeTruthy();
  });

  it('says it is reconnecting rather than pretending to be live', () => {
    const { container } = render(
      <CustomerQueueBoard board={customerBoard} stream="reconnecting" stale />,
    );
    expect(within(container).getByText('Reconnecting…')).toBeTruthy();
    expect(within(container).queryByText('Live')).toBeNull();
  });

  it('renders nothing that could identify a guest', () => {
    const { container } = render(
      <CustomerQueueBoard board={customerBoard} branchName="Alpha Main" stream="open" />,
    );
    const text = container.textContent ?? '';
    // The projection carries no names, party sizes or ids — assert the screen
    // does not invent any either.
    expect(text).not.toMatch(/guest|party|customer/i);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no uuids
  });
});

describe('AdminQueueBoard', () => {
  it('shows the operational picture: three columns and the day counts', () => {
    render(<AdminQueueBoard board={adminBoard} branchName="Alpha Main" stream="open" />);
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Called')).toBeTruthy();
    expect(screen.getByText('Seated')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Table T9')).toBeTruthy();
    // Party sizes are shown per row (every fixture token seats four).
    expect(screen.getAllByText(/4 guests/)).toHaveLength(3);
    expect(screen.getByText(/no show/).textContent).toMatch(/2\s*no show/);
  });

  it('is read-only — a device never mutates the queue', () => {
    render(<AdminQueueBoard board={adminBoard} stream="open" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows customer names nowhere, because the projection has none', () => {
    const { container } = render(<AdminQueueBoard board={adminBoard} stream="open" />);
    expect(container.textContent).not.toMatch(/Asha|Rao/);
  });

  it('reports an empty column plainly', () => {
    render(
      <AdminQueueBoard
        board={{ ...adminBoard, waiting: [], called: [], seated: [] }}
        stream="open"
      />,
    );
    expect(screen.getByText('Nobody waiting')).toBeTruthy();
    expect(screen.getByText('Nobody called')).toBeTruthy();
    expect(screen.getByText('Nobody seated')).toBeTruthy();
  });
});

describe('PairingForm', () => {
  const CREDENTIAL = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);

  it('pairs with a well-formed credential and a branch', () => {
    const onPair = vi.fn();
    render(<PairingForm onPair={onPair} />);
    fireEvent.change(screen.getByLabelText('Branch ID'), { target: { value: 'br-1' } });
    fireEvent.change(screen.getByLabelText('Device credential'), { target: { value: CREDENTIAL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair screen' }));
    expect(onPair).toHaveBeenCalledWith({ credential: CREDENTIAL, branchId: 'br-1' });
  });

  it('rejects a malformed credential before any request is made', () => {
    const onPair = vi.fn();
    render(<PairingForm onPair={onPair} />);
    fireEvent.change(screen.getByLabelText('Branch ID'), { target: { value: 'br-1' } });
    fireEvent.change(screen.getByLabelText('Device credential'), { target: { value: 'nonsense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair screen' }));
    expect(onPair).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/does not look like/);
  });

  it('requires a branch', () => {
    const onPair = vi.fn();
    render(<PairingForm onPair={onPair} />);
    fireEvent.change(screen.getByLabelText('Device credential'), { target: { value: CREDENTIAL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair screen' }));
    expect(onPair).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/branch/i);
  });

  it('masks the credential field and offers no staff login', () => {
    render(<PairingForm onPair={vi.fn()} />);
    expect((screen.getByLabelText('Device credential') as HTMLInputElement).type).toBe('password');
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByLabelText(/password$/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the server\'s pairing error', () => {
    render(<PairingForm onPair={vi.fn()} error="This screen is not paired" />);
    expect(screen.getByRole('alert').textContent).toBe('This screen is not paired');
  });
});

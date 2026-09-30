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
const finish = vi.fn();
const skip = vi.fn();
const checkIn = vi.fn();
const contact = vi.fn();
const tableAvailability = vi.fn();
const register = vi.fn();

vi.mock('@/lib/queue/api', () => ({
  queueApi: {
    call: (...a: unknown[]) => call(...a),
    seat: (...a: unknown[]) => seat(...a),
    noShow: (...a: unknown[]) => noShow(...a),
    cancel: (...a: unknown[]) => cancel(...a),
    assignTable: (...a: unknown[]) => assignTable(...a),
    releaseTable: (...a: unknown[]) => releaseTable(...a),
    finish: (...a: unknown[]) => finish(...a),
    skip: (...a: unknown[]) => skip(...a),
    checkIn: (...a: unknown[]) => checkIn(...a),
    contact: (...a: unknown[]) => contact(...a),
    tableAvailability: (...a: unknown[]) => tableAvailability(...a),
    register: (...a: unknown[]) => register(...a),
  },
}));

vi.mock('@/components/shell/branch-chip', () => ({ BranchChip: () => null }));

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

import PodiumPage from './(staff)/(app)/queue/podium/page';

const CTX = { companyId: 'co-1', branchId: 'br-1' };

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
  finished_at: null,
  cancelled_at: null,
  no_show_at: null,
  skipped_at: null,
  skip_count: 0,
  created_at: '2026-09-07T10:00:00.000Z',
  updated_at: '2026-09-07T10:00:00.000Z',
  ...over,
});

const makeBoard = (over: Partial<QueueBoard> = {}): QueueBoard => ({
  branch_id: 'br-1',
  service_date: '2026-09-07',
  next_token_number: 6,
  counts: { scheduled: 0, waiting: 1, called: 1, seated: 0, no_show: 0, cancelled: 0 },
  totals: { parties: 1, adults: 2, kids: 0 },
  next_waiting: token({ id: 'w-1', token_number: 5, customer_id: 'c-1', customer: { id: 'c-1', name: 'Asha Rao' } }),
  scheduled: [],
  waiting: [token({ id: 'w-1', token_number: 5, customer_id: 'c-1', customer: { id: 'c-1', name: 'Asha Rao' } })],
  called: [token({ id: 'c-1', token_number: 4, status: 'CALLED', called_at: '2026-09-07T10:05:00.000Z' })],
  seated: [],
  ...over,
});

const FREE = (id: string, label: string, capacity: number) => ({
  id,
  label,
  capacity,
  zone: null,
  status: 'ACTIVE' as const,
  occupied_by: null,
});

const ALL = ['queue.view', 'queue.call', 'queue.seat', 'queue.no_show', 'queue.cancel', 'queue.register', 'tables.view'];

/** Renders the podium and opens the Call Customers tab. */
const renderCall = () => {
  render(<PodiumPage />);
  const tab = screen.queryByRole('tab', { name: /Call Customers/ });
  if (tab) fireEvent.click(tab);
};

describe('Podium operator — tabs and registering', () => {
  beforeEach(() => {
    register.mockReset().mockResolvedValue({ id: 'n-1', token_number: 6, adults: 2, kids: 0, party_size: 2, customer: null, advance_booking_at: null });
    refresh.mockReset().mockResolvedValue(undefined);
    tableAvailability.mockReset().mockResolvedValue([]);
    branchPermissions = [...ALL];
    companyPermissions = [];
    board = makeBoard();
    stream = 'open';
  });

  it('is headed Podium Operator and opens on Register, with the next token number', () => {
    render(<PodiumPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Podium Operator' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected')])).toEqual([
      ['Register', 'true'],
      ['Call Customers', 'false'],
    ]);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('podium-tab-register');
    expect(screen.getByLabelText('Next token').textContent).toMatch(/6/);
    // The podium may hold a table for later today.
    expect(screen.getByLabelText(/Advance booking time/)).toBeTruthy();
    expect(screen.queryByLabelText('Next party')).toBeNull();
  });

  it('registers a party and reconciles the board', async () => {
    render(<PodiumPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Register Customer' }));
    await waitFor(() => expect(register).toHaveBeenCalledWith(CTX, { adults: 2 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toMatch(/Added to the queue/);
  });

  it('switches to Call Customers', () => {
    renderCall();
    expect(screen.getByRole('tab', { name: /Call Customers/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Next party')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register Customer' })).toBeNull();
  });

  it('has no Register tab without queue.register — it opens straight on calling', () => {
    branchPermissions = ALL.filter((p) => p !== 'queue.register');
    render(<PodiumPage />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByLabelText('Next party')).toBeTruthy();
  });
});

describe('Podium operator — calling', () => {
  beforeEach(() => {
    for (const m of [call, seat, noShow, cancel, assignTable, releaseTable, finish, skip, checkIn, contact, refresh]) m.mockReset();
    refresh.mockResolvedValue(undefined);
    call.mockResolvedValue(token({ status: 'CALLED', token_number: 5 }));
    seat.mockResolvedValue(token({ status: 'SEATED', token_number: 4 }));
    noShow.mockResolvedValue(token({ status: 'NO_SHOW', token_number: 4 }));
    cancel.mockResolvedValue(token({ status: 'CANCELLED', token_number: 5 }));
    releaseTable.mockResolvedValue(token({ status: 'SEATED', token_number: 4 }));
    finish.mockResolvedValue(token({ status: 'SEATED', token_number: 8 }));
    skip.mockResolvedValue(token({ status: 'WAITING', token_number: 4, skip_count: 1 }));
    checkIn.mockResolvedValue(token({ status: 'WAITING', token_number: 9 }));
    contact.mockResolvedValue({
      token_id: 'w-1',
      customer_name: 'Asha Rao',
      phone: '+919876500001',
      tel_url: 'tel:+919876500001',
      whatsapp_url: 'https://wa.me/919876500001',
    });
    tableAvailability.mockReset().mockResolvedValue([FREE('tbl-1', 'T1', 4), FREE('tbl-2', 'T2', 2)]);
    branchPermissions = [...ALL];
    companyPermissions = [];
    board = makeBoard();
    stream = 'open';
  });

  it('makes the next party unmissable and calls it', async () => {
    renderCall();
    const next = screen.getByLabelText('Next party');
    expect(within(next).getByText('5')).toBeTruthy();
    expect(within(next).getByText('Asha Rao')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(CTX, 'w-1'));
  });

  it('reconciles with the server after every action — a request is not a result', async () => {
    renderCall();
    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('still refetches when an action FAILS, so the operator sees the real state', async () => {
    call.mockRejectedValue(new Error('Cannot move a queue token from CALLED to CALLED'));
    renderCall();
    fireEvent.click(screen.getByRole('button', { name: 'Call 5' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/Cannot move a queue token/);
  });

  it('seats a called party, with a table when one is chosen', async () => {
    renderCall();
    await waitFor(() => expect(tableAvailability).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText('Table for token 4'), { target: { value: 'tbl-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Seat at table' }));

    await waitFor(() => expect(seat).toHaveBeenCalledWith(CTX, 'c-1', 'tbl-2'));
  });

  it('seats without a table when none is chosen', async () => {
    renderCall();
    fireEvent.click(await screen.findByRole('button', { name: 'Seat' }));
    await waitFor(() => expect(seat).toHaveBeenCalledWith(CTX, 'c-1', undefined));
  });

  it('marks a no show and cancels', async () => {
    renderCall();
    fireEvent.click(screen.getByRole('button', { name: 'No show' }));
    await waitFor(() => expect(noShow).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('offers "Table cleared" only for a seated party that holds one', async () => {
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
      counts: { scheduled: 0, waiting: 1, called: 0, seated: 1, no_show: 0, cancelled: 0 },
    });
    renderCall();

    expect(screen.queryByRole('button', { name: 'Guests left' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Table cleared' }));
    await waitFor(() => expect(releaseTable).toHaveBeenCalledWith(CTX, 's-1'));
    expect(await screen.findByText(/Table T1 is free — token 4 has left/)).toBeTruthy();
  });

  it('marks a party seated without a table as left, and a party that left is only shown', async () => {
    board = makeBoard({
      called: [],
      seated: [
        token({ id: 's-8', token_number: 8, status: 'SEATED', seated_at: '2026-09-07T10:10:00.000Z' }),
        token({
          id: 's-9',
          token_number: 9,
          status: 'SEATED',
          seated_at: '2026-09-07T10:10:00.000Z',
          finished_at: '2026-09-07T11:00:00.000Z',
        }),
      ],
      counts: { scheduled: 0, waiting: 1, called: 0, seated: 2, no_show: 0, cancelled: 0 },
    });
    renderCall();

    // Only the party still here can leave; the one that left reads "Left".
    expect(screen.getAllByRole('button', { name: 'Guests left' })).toHaveLength(1);
    expect(screen.getByText('Left')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guests left' }));
    await waitFor(() => expect(finish).toHaveBeenCalledWith(CTX, 's-8'));
    expect(await screen.findByText(/Token 8 has left/)).toBeTruthy();
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
    renderCall();

    const select = await screen.findByLabelText('Table for token 4');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.includes('T2'))).toBe(true);
    expect(options.some((o) => o?.includes('T1'))).toBe(false);
  });

  it('hides actions the viewer has no permission for', () => {
    branchPermissions = ['queue.view'];
    renderCall();
    expect(screen.queryByRole('button', { name: /^Call/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('says so plainly when nobody is waiting', () => {
    board = makeBoard({
      waiting: [],
      next_waiting: null,
      counts: { scheduled: 0, waiting: 0, called: 1, seated: 0, no_show: 0, cancelled: 0 },
    });
    renderCall();
    expect(screen.getByText('Nobody is waiting.')).toBeTruthy();
  });

  it('skips a called party that did not respond', async () => {
    renderCall();
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(skip).toHaveBeenCalledWith(CTX, 'c-1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('lists advance bookings separately and checks one in', async () => {
    board = makeBoard({
      scheduled: [
        token({ id: 'sc-1', token_number: 9, status: 'SCHEDULED', advance_booking_at: '2026-09-07T13:30:00.000Z' }),
      ],
      counts: { scheduled: 1, waiting: 1, called: 1, seated: 0, no_show: 0, cancelled: 0 },
    });
    renderCall();
    const section = screen.getByRole('heading', { name: 'Scheduled' }).closest('section')!;
    expect(within(section).getByText(/Booked for/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith(CTX, 'sc-1'));
  });

  it('offers no check-in without queue.register', () => {
    branchPermissions = ALL.filter((p) => p !== 'queue.register');
    board = makeBoard({ scheduled: [token({ id: 'sc-1', token_number: 9, status: 'SCHEDULED' })] });
    renderCall();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it('reveals a phone only with customers.view', async () => {
    renderCall();
    // queue.call alone is not enough to read a phone number.
    expect(screen.queryByRole('button', { name: 'Contact' })).toBeNull();
  });

  it('fetches contact details on demand and offers a call and a WhatsApp message', async () => {
    companyPermissions = ['customers.view'];
    renderCall();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Contact' }))[0]);
    await waitFor(() => expect(contact).toHaveBeenCalledWith(CTX, 'w-1'));
    expect((await screen.findByRole('link', { name: /Phone \+919876500001/ })).getAttribute('href')).toBe(
      'tel:+919876500001',
    );
    expect(screen.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toBe('https://wa.me/919876500001');
  });

  it('never offers a table still held by a party seated on an earlier day', async () => {
    tableAvailability.mockResolvedValue([
      { ...FREE('tbl-1', 'T1', 4), occupied_by: { token_id: 'old', token_number: 88, service_date: '2026-09-06' } },
      FREE('tbl-2', 'T2', 2),
    ]);
    renderCall();
    await waitFor(() => expect(tableAvailability).toHaveBeenCalled());
    const select = await screen.findByLabelText('Table for token 4');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((o) => o?.includes('T2'))).toBe(true);
    expect(options.some((o) => o?.includes('T1'))).toBe(false);
  });

  it('shows the waiting totals — parties, adults and kids', () => {
    board = makeBoard({ totals: { parties: 3, adults: 7, kids: 2 } });
    renderCall();
    expect(screen.getByLabelText('Waiting totals').textContent).toMatch(/3\s*parties waiting · 7\s*adults · 2\s*kids/);
  });

  it('shows a live wait time counted from when the party joined', () => {
    vi.setSystemTime(new Date('2026-09-07T10:12:30.000Z'));
    renderCall();
    expect(screen.getByText(/waiting 12 min/)).toBeTruthy();
    vi.useRealTimers();
  });

  it('shows the live connection state and keeps a manual refresh available', () => {
    stream = 'reconnecting';
    renderCall();
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalled();
  });
});

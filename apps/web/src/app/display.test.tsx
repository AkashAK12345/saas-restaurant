import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuth } from '@/lib/auth/auth-provider';
import { deviceSession } from '@/lib/display/device-session';
import { DisplayAuthError } from '@/lib/display/display-api';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { QueueAdminBoard, QueueCustomerBoard } from '@/lib/queue/types';

const me = vi.fn();
const branch = vi.fn();
const customerBoard = vi.fn();
const adminBoard = vi.fn();
const streamTicket = vi.fn();

vi.mock('@/lib/display/display-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/display/display-api')>(
    '@/lib/display/display-api',
  );
  return {
    ...actual,
    displayApi: {
      me: (...a: unknown[]) => me(...a),
      branch: (...a: unknown[]) => branch(...a),
      customerBoard: (...a: unknown[]) => customerBoard(...a),
      adminBoard: (...a: unknown[]) => adminBoard(...a),
      streamTicket: (...a: unknown[]) => streamTicket(...a),
    },
  };
});

import QueueDisplayPage from './(display)/display/queue/page';
import BanquetDisplayPage from './(display)/display/banquet/page';

const CREDENTIAL = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);

const CUSTOMER_BOARD: QueueCustomerBoard = {
  branch_id: 'br-1',
  service_date: '2026-09-07',
  now_serving: [{ token_number: 21, table_label: 'T2', called_at: '2026-09-07T10:00:00.000Z' }],
  recently_seated: [],
  waiting_count: 3,
  waiting_tokens: [22, 23, 24],
};

const ADMIN_BOARD: QueueAdminBoard = {
  branch_id: 'br-1',
  service_date: '2026-09-07',
  counts: { scheduled: 0, waiting: 3, called: 1, seated: 0, no_show: 0, cancelled: 0 },
  totals: { parties: 3, adults: 6, kids: 1 },
  waiting: [],
  called: [],
  seated: [],
};

/**
 * The display surface must not expose staff functionality: no session, no
 * navigation, no RBAC. These tests exercise the real Phase 7 page — pairing,
 * both device projections, and the unpaired path — with the device API mocked.
 */
describe('queue display screen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    me.mockReset().mockResolvedValue({ id: 'd-1', branch_id: 'br-1', kind: 'QUEUE_CUSTOMER' });
    branch.mockReset().mockResolvedValue({ id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata' });
    customerBoard.mockReset().mockResolvedValue(CUSTOMER_BOARD);
    adminBoard.mockReset().mockResolvedValue(ADMIN_BOARD);
    streamTicket.mockReset().mockResolvedValue({
      ticket: 'b'.repeat(64),
      expires_at: '',
      channel: 'queue',
      branch_id: 'br-1',
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks to be paired when the device has no credential, and stores it', async () => {
    render(<QueueDisplayPage />);
    const credentialField = await screen.findByLabelText('Device credential');
    fireEvent.change(screen.getByLabelText('Branch ID'), { target: { value: 'br-1' } });
    fireEvent.change(credentialField, { target: { value: CREDENTIAL } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair screen' }));

    await waitFor(() => expect(deviceSession.get()).toEqual({ credential: CREDENTIAL, branchId: 'br-1' }));
    await waitFor(() => expect(customerBoard).toHaveBeenCalled());
  });

  it('shows the customer board for a QUEUE_CUSTOMER device', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);

    expect(await screen.findByText('21')).toBeTruthy();
    expect(screen.getByText('Table T2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Now serving' })).toBeTruthy();
    expect(adminBoard).not.toHaveBeenCalled();
  });

  it('shows the admin board for a QUEUE_ADMIN device — the SERVER picks, not the URL', async () => {
    me.mockResolvedValue({ id: 'd-2', branch_id: 'br-1', kind: 'QUEUE_ADMIN' });
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);

    expect(await screen.findByRole('heading', { name: 'Queue overview' })).toBeTruthy();
    expect(adminBoard).toHaveBeenCalled();
    expect(customerBoard).not.toHaveBeenCalled();
  });

  it('falls back to pairing when the credential is refused (revoked or wrong branch)', async () => {
    me.mockRejectedValue(new DisplayAuthError('This screen is not paired'));
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);

    expect(await screen.findByRole('heading', { name: 'Pair this screen' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not paired/);
  });

  it('subscribes with a fresh single-use ticket and never puts the credential in the URL', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);

    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    const url = FakeEventSource.last()!.url;
    expect(url).toContain(`ticket=${'b'.repeat(64)}`);
    expect(url).not.toContain(CREDENTIAL.split('.')[1]);
  });

  it('refetches the board when a queue event arrives', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());

    customerBoard.mockResolvedValue({ ...CUSTOMER_BOARD, waiting_count: 9 });
    FakeEventSource.last()!.emit('queue.token.registered', { token_number: 22 });

    expect(await screen.findByText('9')).toBeTruthy();
  });

  it('reports an unreachable server instead of showing a blank screen', async () => {
    me.mockRejectedValue(new Error('Failed to fetch'));
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);

    expect(await screen.findByRole('heading', { name: 'Cannot reach the server' })).toBeTruthy();
  });

  it('offers no staff navigation, links or sign-in anywhere on a paired screen', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<QueueDisplayPage />);
    await screen.findByText('21');

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/sign (in|out)/i)).toBeNull();
    // The only buttons a paired screen has are the wall-screen presentation
    // controls (full screen, density) — none reads or changes queue data.
    const controls = screen.getByRole('group', { name: 'Screen controls' });
    for (const button of screen.queryAllByRole('button')) {
      expect(controls.contains(button)).toBe(true);
      expect(['Compact', 'Larger text', 'Full screen', 'Exit full screen']).toContain(button.textContent);
    }
  });

  it('the chef display renders standalone and asks to be paired', async () => {
    // Phase 8 replaced the placeholder with the real kitchen screen; unpaired,
    // it shows the same device pairing form and still no staff affordances.
    render(<BanquetDisplayPage />);
    expect(await screen.findByRole('heading', { name: 'Pair this screen' })).toBeDefined();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/sign (in|out)/i)).toBeNull();
  });

  it('the staff session hook throws outside the staff root — no display tree can reach a session', () => {
    function Leak() {
      useAuth();
      return null;
    }
    expect(() => render(<Leak />)).toThrow(/AuthProvider/);
  });
});

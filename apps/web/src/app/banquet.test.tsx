import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { BanquetBookingDetail, ChefBoard, StaffKdsBoard } from '@/lib/banquet/types';

// ── mocks ────────────────────────────────────────────────────────────────────

const apiMock = vi.hoisted(() => ({
  getBooking: vi.fn(),
  confirmBooking: vi.fn(),
  completeBooking: vi.fn(),
  cancelBooking: vi.fn(),
  createPayment: vi.fn(),
  saveEventPlan: vi.fn(),
  kdsBoard: vi.fn(),
  startItem: vi.fn(),
  readyItem: vi.fn(),
  streamTicket: vi.fn(),
  listBookings: vi.fn(),
  listHalls: vi.fn(),
  listPackages: vi.fn(),
  customers: vi.fn(),
}));
/**
 * Forwards every call to the hoisted spies without freezing their identity.
 * Hoisted itself, because `vi.mock` factories run before top-level consts.
 */
const lazyProxy = vi.hoisted(
  () =>
    <T extends Record<string, (...args: never[]) => unknown>>(target: T) =>
      new Proxy(target, {
        get: (t, k: string) => (...a: unknown[]) =>
          (t[k] as unknown as (...args: unknown[]) => unknown)(...a),
      }),
);

vi.mock('@/lib/banquet/api', () => ({ banquetApi: lazyProxy(apiMock) }));

let branchPermissions: string[] = [];
let companyPermissions: string[] = [];
let selectedBranchId: string | null = 'br-1';
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId,
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

let pathname = '/banquet';
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({ id: 'bk-1' }),
  useRouter: () => router,
}));

const displayApiMock = vi.hoisted(() => ({
  banquetBoard: vi.fn(),
  branch: vi.fn(),
  streamTicket: vi.fn(),
}));
vi.mock('@/lib/display/display-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/display/display-api')>(
    '@/lib/display/display-api',
  );
  return {
    ...actual,
    displayApi: lazyProxy(displayApiMock),
  };
});

import BookingDetailPage from './(staff)/(app)/banquet/[id]/page';
import BanquetLayout from './(staff)/(app)/banquet/layout';
import KitchenPage from './(staff)/(app)/banquet/kitchen/page';
import BookingsPage from './(staff)/(app)/banquet/page';
import CatalogPage from './(staff)/(app)/banquet/catalog/page';
import ChefDisplayPage from './(display)/display/banquet/page';
import { deviceSession } from '@/lib/display/device-session';

// ── fixtures ─────────────────────────────────────────────────────────────────

const booking = (over: Partial<BanquetBookingDetail> = {}): BanquetBookingDetail => ({
  id: 'bk-1',
  company_id: 'co-1',
  branch_id: 'br-1',
  customer_id: 'c-1',
  customer: { id: 'c-1', name: 'Meera Iyer' },
  hall_id: 'h-1',
  hall: { id: 'h-1', name: 'Crystal', capacity: 200 },
  package_id: 'p-1',
  starts_at: '2027-11-20T12:00:00.000Z',
  ends_at: '2027-11-20T18:00:00.000Z',
  guest_count: 80,
  status: 'DRAFT',
  package_name: 'Gold Veg',
  price_per_guest_minor: 125_000,
  currency: 'INR',
  total_amount_minor: 10_000_000,
  notes: null,
  confirmed_at: null,
  completed_at: null,
  cancelled_at: null,
  created_at: '2026-09-07T10:00:00.000Z',
  updated_at: '2026-09-07T10:00:00.000Z',
  items: [
    { id: 'i-1', name: 'Paneer Tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null },
  ],
  payments: [],
  balance: {
    currency: 'INR',
    total_amount_minor: 10_000_000,
    paid_minor: 0,
    balance_minor: 10_000_000,
    fully_paid: false,
  },
  event_plan: null,
  ...over,
});

const staffBoard = (over: Partial<StaffKdsBoard> = {}): StaffKdsBoard => ({
  branch_id: 'br-1',
  service_date: '2027-11-20',
  counts: { events: 1, pending: 1, in_progress: 0, ready: 0 },
  bookings: [
    {
      id: 'bk-1',
      branch_id: 'br-1',
      hall_name: 'Crystal',
      guest_count: 80,
      starts_at: '2027-11-20T12:00:00.000Z',
      ends_at: '2027-11-20T18:00:00.000Z',
      service_at: '2027-11-20T13:00:00.000Z',
      kitchen_notes: 'No nuts',
      status: 'CONFIRMED',
      customer_name: 'Meera Iyer',
      items: [
        { id: 'i-1', name: 'Paneer Tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null },
      ],
    },
  ],
  ...over,
});

const chefBoard = (over: Partial<ChefBoard> = {}): ChefBoard => ({
  branch_id: 'br-1',
  service_date: '2027-11-20',
  counts: { events: 1, pending: 1, in_progress: 0, ready: 0 },
  bookings: [
    {
      id: 'bk-1',
      branch_id: 'br-1',
      hall_name: 'Crystal',
      guest_count: 80,
      starts_at: '2027-11-20T12:00:00.000Z',
      ends_at: '2027-11-20T18:00:00.000Z',
      service_at: '2027-11-20T13:00:00.000Z',
      kitchen_notes: 'No nuts',
      status: 'CONFIRMED',
      items: [
        { id: 'i-1', name: 'Paneer Tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null },
      ],
    },
  ],
  ...over,
});

const ALL_PERMS = [
  'banquet.view',
  'banquet.booking.confirm',
  'banquet.booking.complete',
  'banquet.booking.cancel',
  'banquet.payment.create',
  'banquet.event_plan.manage',
  'banquet.kds.view',
  'banquet.kds.manage',
];

// ── booking detail ───────────────────────────────────────────────────────────

describe('Banquet booking detail', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.getBooking.mockResolvedValue(booking());
    apiMock.confirmBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    apiMock.cancelBooking.mockResolvedValue(booking({ status: 'CANCELLED' }));
    apiMock.completeBooking.mockResolvedValue(booking({ status: 'COMPLETED' }));
    apiMock.createPayment.mockResolvedValue({ payment: {}, balance: {} });
    apiMock.saveEventPlan.mockResolvedValue({});
    branchPermissions = [...ALL_PERMS];
    companyPermissions = [];
  });

  it('shows the commercial snapshot and the derived balance', async () => {
    render(<BookingDetailPage />);
    expect(await screen.findByText('Meera Iyer')).toBeTruthy();
    expect(screen.getByText('Crystal')).toBeTruthy();
    expect(screen.getByText(/Gold Veg/)).toBeTruthy();
    // ₹100,000.00 total, nothing paid
    expect(screen.getAllByText(/1,00,000|100,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Balance due')).toBeTruthy();
  });

  it('offers only the actions the current state allows', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeTruthy();
  });

  it('confirms and then reconciles with the server', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    apiMock.getBooking.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(apiMock.confirmBooking).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.getBooking).toHaveBeenCalled());
  });

  it('shows a hall conflict plainly and still refetches', async () => {
    apiMock.confirmBooking.mockRejectedValue(
      new Error('That hall is already booked for an overlapping time.'),
    );
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    apiMock.getBooking.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already booked/i);
    await waitFor(() => expect(apiMock.getBooking).toHaveBeenCalled());
  });

  it('sends a payment as whole minor units', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '25000.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(apiMock.createPayment).toHaveBeenCalled());
    expect(apiMock.createPayment.mock.calls[0][2]).toEqual({
      amount_minor: 2_500_050,
      currency: 'INR',
    });
  });

  it('refuses to submit an unparseable or excessive amount', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    const field = screen.getByLabelText('Amount (INR)');
    const submit = () => screen.getByRole('button', { name: 'Record payment' }) as HTMLButtonElement;

    fireEvent.change(field, { target: { value: 'abc' } });
    expect(submit().disabled).toBe(true);

    fireEvent.change(field, { target: { value: '999999' } }); // more than the balance
    expect(submit().disabled).toBe(true);

    fireEvent.change(field, { target: { value: '1000' } });
    expect(submit().disabled).toBe(false);
  });

  it('hides the payment form once the balance is settled', async () => {
    apiMock.getBooking.mockResolvedValue(
      booking({
        status: 'CONFIRMED',
        balance: {
          currency: 'INR',
          total_amount_minor: 10_000_000,
          paid_minor: 10_000_000,
          balance_minor: 0,
          fully_paid: true,
        },
      }),
    );
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('says payments cannot be edited', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByText(/permanent record and cannot be edited/i)).toBeTruthy();
  });

  it('saves the event plan', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Kitchen notes'), { target: { value: 'No nuts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(apiMock.saveEventPlan).toHaveBeenCalled());
    expect(apiMock.saveEventPlan.mock.calls[0][2]).toMatchObject({ kitchen_notes: 'No nuts' });
  });

  it('hides every mutation without the permissions', async () => {
    branchPermissions = ['banquet.view'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull();
  });
});

// ── layout ───────────────────────────────────────────────────────────────────

describe('Banquet sub-navigation', () => {
  beforeEach(() => {
    selectedBranchId = 'br-1';
    pathname = '/banquet';
    branchPermissions = ['banquet.view', 'banquet.kds.view'];
  });
  afterEach(() => {
    selectedBranchId = 'br-1';
  });

  it('asks for a branch first', () => {
    selectedBranchId = null;
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(screen.getByText(/Select a branch/)).toBeTruthy();
    expect(screen.queryByText('child')).toBeNull();
  });

  it('shows the permitted sections and marks the current one', () => {
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Bookings',
      'Halls & packages',
      'Kitchen',
    ]);
    expect(screen.getByRole('link', { name: 'Bookings' }).getAttribute('aria-current')).toBe('page');
  });

  // The main nav and the home card open /banquet (bookings). A chef may use
  // the kitchen only, and used to land on a refusal instead.
  it('sends someone who may only use the kitchen from /banquet to the kitchen', () => {
    router.replace.mockReset();
    branchPermissions = ['banquet.kds.view', 'banquet.kds.manage'];
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(router.replace).toHaveBeenCalledWith('/banquet/kitchen');
    expect(screen.queryByText('child')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Opening Kitchen…');
  });

  it('keeps someone who may see bookings on /banquet', () => {
    router.replace.mockReset();
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('never redirects away from another banquet page, or without any banquet permission', () => {
    router.replace.mockReset();
    branchPermissions = ['banquet.kds.view'];
    pathname = '/banquet/kitchen';
    const { unmount } = render(
      <BanquetLayout>
        <p>kitchen</p>
      </BanquetLayout>,
    );
    expect(screen.getByText('kitchen')).toBeTruthy();
    unmount();

    // No banquet section at all: the page itself shows the refusal.
    branchPermissions = [];
    pathname = '/banquet';
    render(
      <BanquetLayout>
        <p>refused page</p>
      </BanquetLayout>,
    );
    expect(screen.getByText('refused page')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('drops the kitchen for someone without banquet.kds.view', () => {
    branchPermissions = ['banquet.view'];
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Bookings',
      'Halls & packages',
    ]);
  });
});

// ── staff kitchen ────────────────────────────────────────────────────────────

describe('Staff kitchen board', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.kdsBoard.mockResolvedValue(staffBoard());
    apiMock.startItem.mockResolvedValue({});
    apiMock.readyItem.mockResolvedValue({});
    apiMock.streamTicket.mockResolvedValue({ ticket: 'a'.repeat(64) });
    branchPermissions = [...ALL_PERMS];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the events, the kitchen notes and the customer', async () => {
    render(<KitchenPage />);
    expect(await screen.findByText('Crystal')).toBeTruthy();
    expect(screen.getByText('Paneer Tikka')).toBeTruthy();
    expect(screen.getByText('No nuts')).toBeTruthy();
    expect(screen.getByText(/Meera Iyer/)).toBeTruthy();
  });

  it('advances an item and reconciles', async () => {
    render(<KitchenPage />);
    await screen.findByText('Crystal');
    apiMock.kdsBoard.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(apiMock.startItem).toHaveBeenCalledWith(
      { companyId: 'co-1', branchId: 'br-1' },
      'i-1',
    ));
    await waitFor(() => expect(apiMock.kdsBoard).toHaveBeenCalled());
  });

  it('refetches when a banquet event arrives', async () => {
    render(<KitchenPage />);
    await screen.findByText('Crystal');
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    apiMock.kdsBoard.mockResolvedValue(
      staffBoard({ counts: { events: 9, pending: 0, in_progress: 0, ready: 0 } }),
    );

    FakeEventSource.last()!.emit('banquet.item.updated', { id: 'bk-1' });
    await waitFor(() => expect(screen.getByText(/9 events/)).toBeTruthy());
  });

  it('puts only the ticket in the stream URL', async () => {
    render(<KitchenPage />);
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    const url = FakeEventSource.last()!.url;
    expect(url).toContain(`ticket=${'a'.repeat(64)}`);
    expect(url).not.toContain('Bearer');
  });

  it('hides the advance buttons without banquet.kds.manage', async () => {
    branchPermissions = ['banquet.view', 'banquet.kds.view'];
    render(<KitchenPage />);
    await screen.findByText('Crystal');
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ready' })).toBeNull();
  });
});

// ── chef display ─────────────────────────────────────────────────────────────

describe('Chef display', () => {
  const CREDENTIAL = '11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);

  beforeEach(() => {
    window.localStorage.clear();
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    displayApiMock.banquetBoard.mockReset().mockResolvedValue(chefBoard());
    displayApiMock.branch.mockReset().mockResolvedValue({ id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata' });
    displayApiMock.streamTicket.mockReset().mockResolvedValue({ ticket: 'b'.repeat(64) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks to be paired when the device has no credential', async () => {
    render(<ChefDisplayPage />);
    expect(await screen.findByRole('heading', { name: 'Pair this screen' })).toBeTruthy();
    expect(displayApiMock.banquetBoard).not.toHaveBeenCalled();
  });

  it('renders the kitchen board for a paired device', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<ChefDisplayPage />);
    expect(await screen.findByText('Crystal')).toBeTruthy();
    expect(screen.getByText('80 covers')).toBeTruthy();
    expect(screen.getByText('Paneer Tikka')).toBeTruthy();
    expect(screen.getByText('No nuts')).toBeTruthy();
  });

  it('exposes no customer identity, no money and no controls', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    const { container } = render(<ChefDisplayPage />);
    await screen.findByText('Crystal');

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Meera|Iyer/);
    expect(text).not.toMatch(/₹|\$|INR|total|balance|price/i);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('subscribes on banquet-kds with a fresh ticket, never the credential', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<ChefDisplayPage />);
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());

    expect(displayApiMock.streamTicket.mock.calls[0][1]).toBe('banquet-kds');
    const url = FakeEventSource.last()!.url;
    expect(url).toContain(`ticket=${'b'.repeat(64)}`);
    expect(url).not.toContain(CREDENTIAL.split('.')[1]);
  });

  it('updates live when an event arrives, with no reload', async () => {
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<ChefDisplayPage />);
    await screen.findByText('Crystal');
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());

    displayApiMock.banquetBoard.mockResolvedValue(
      chefBoard({
        bookings: [{ ...chefBoard().bookings[0], hall_name: 'Emerald' }],
      }),
    );
    FakeEventSource.last()!.emit('banquet.booking.confirmed', { id: 'bk-2' });
    expect(await screen.findByText('Emerald')).toBeTruthy();
  });

  it('falls back to pairing when the credential is refused', async () => {
    const { DisplayAuthError } = await vi.importActual<typeof import('@/lib/display/display-api')>(
      '@/lib/display/display-api',
    );
    displayApiMock.banquetBoard.mockRejectedValue(new DisplayAuthError('This screen is not paired'));
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<ChefDisplayPage />);
    expect(await screen.findByRole('heading', { name: 'Pair this screen' })).toBeTruthy();
  });

  it('says so when there are no events rather than showing a blank screen', async () => {
    displayApiMock.banquetBoard.mockResolvedValue(
      chefBoard({ bookings: [], counts: { events: 0, pending: 0, in_progress: 0, ready: 0 } }),
    );
    deviceSession.set({ credential: CREDENTIAL, branchId: 'br-1' });
    render(<ChefDisplayPage />);
    expect(await screen.findByText('No events today')).toBeTruthy();
  });
});

// ── refused loads ────────────────────────────────────────────────────────────

/**
 * Someone who reaches a banquet screen without the permission gets a 403. The
 * page once showed that AND its empty state — "No bookings yet." — which told
 * them there was nothing booked when they simply may not see it.
 */
describe('Banquet lists when the load is refused', () => {
  const emptyPage = { data: [], meta: { total: 0, limit: 100, offset: 0 } };
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.listHalls.mockResolvedValue(emptyPage);
    apiMock.listPackages.mockResolvedValue(emptyPage);
    apiMock.customers.mockResolvedValue(emptyPage);
    branchPermissions = ['banquet.view', 'banquet.create'];
    companyPermissions = ['customers.view'];
    selectedBranchId = 'br-1';
    pathname = '/banquet';
  });

  it('bookings: shows the refusal and makes no empty claim', async () => {
    apiMock.listBookings.mockRejectedValue(new Error('Forbidden'));
    render(<BookingsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText('No bookings yet.')).toBeNull();
  });

  it('bookings: a genuinely empty list still says so', async () => {
    apiMock.listBookings.mockResolvedValue(emptyPage);
    render(<BookingsPage />);
    expect(await screen.findByText('No bookings yet.')).toBeTruthy();
  });

  it('catalogue: shows the refusal and claims neither list is empty', async () => {
    apiMock.listHalls.mockRejectedValue(new Error('Forbidden'));
    render(<CatalogPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText('No halls yet.')).toBeNull();
    expect(screen.queryByText('No packages yet.')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FakeEventSource } from '@/lib/realtime/fake-event-source';
import type { BanquetBookingDetail, ChefBoard, StaffKdsBoard } from '@/lib/banquet/types';

// ── mocks ────────────────────────────────────────────────────────────────────

const apiMock = vi.hoisted(() => ({
  getBooking: vi.fn(),
  confirmBooking: vi.fn(),
  completeBooking: vi.fn(),
  cancelBooking: vi.fn(),
  deleteBooking: vi.fn(),
  createPayment: vi.fn(),
  updatePayment: vi.fn(),
  saveEventPlan: vi.fn(),
  kdsBoard: vi.fn(),
  startItem: vi.fn(),
  readyItem: vi.fn(),
  streamTicket: vi.fn(),
  listBookings: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  addAdjustment: vi.fn(),
  reverseAdjustment: vi.fn(),
  verifyPayment: vi.fn(),
  getBill: vi.fn(),
  availability: vi.fn(),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  updateHall: vi.fn(),
  listHalls: vi.fn(),
  listPackages: vi.fn(),
  customers: vi.fn(),
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  bookingPlateRequests: vi.fn(),
  requestPlates: vi.fn(),
  kitchenPlateRequests: vi.fn(),
  approvePlates: vi.fn(),
  rejectPlates: vi.fn(),
  dispatchPlates: vi.fn(),
  listPhotos: vi.fn(),
  finance: vi.fn(),
  chefCalendar: vi.fn(),
  chefEvent: vi.fn(),
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'u-me', email: 'me@test', first_name: null, last_name: null } }),
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
    selectedBranch: selectedBranchId
      ? { id: selectedBranchId, name: 'Alpha Main', status: 'ACTIVE', timezone: 'Asia/Kolkata', has_roles: true }
      : null,
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

let pathname = '/banquet';
let searchParams = new URLSearchParams();
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({ id: 'bk-1' }),
  useRouter: () => router,
  useSearchParams: () => searchParams,
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
import BookingEditPage from './(staff)/(app)/banquet/[id]/edit/page';
import BanquetLayout from './(staff)/(app)/banquet/layout';
import { ScreenTabBar } from '@/components/app/screen-tab-bar';
import KdsPage from './(staff)/(app)/banquet/kds/page';
import ChefPage from './(staff)/(app)/banquet/kitchen/page';
import ChefEventPage from './(staff)/(app)/banquet/kitchen/[id]/page';
import BookingsPage from './(staff)/(app)/banquet/page';
import CatalogPage from './(staff)/(app)/banquet/catalog/page';
import CalendarPage from './(staff)/(app)/banquet/calendar/page';
import BillPage from './(staff)/(app)/banquet/[id]/bill/page';
import KotPage from './(staff)/(app)/banquet/[id]/kot/page';
import FinancePage from './(staff)/(app)/banquet/finance/page';
import { addCalendarDays, branchToday, daysInMonth } from '@/lib/format/datetime';
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
  hall_name: 'Crystal',
  package_id: 'p-1',
  starts_at: '2037-11-20T12:00:00.000Z',
  ends_at: '2037-11-20T18:00:00.000Z',
  guest_count: 80,
  extra_pax: 0,
  status: 'DRAFT',
  package_name: 'Gold Veg',
  price_per_guest_minor: 125_000,
  currency: 'INR',
  gst_rate_bps: 0,
  total_amount_minor: 10_000_000,
  paid_minor: 0,
  payment_status: 'UNPAID',
  notes: null,
  cancellation_reason: null,
  adjustments: [],
  invoice: {
    base_minor: 10_000_000,
    extra_pax_minor: 0,
    extra_charges_minor: 0,
    gross_minor: 10_000_000,
    line_discount_minor: 0,
    per_head_discount_minor: 0,
    admin_discount_minor: 0,
    discount_minor: 0,
    taxable_minor: 10_000_000,
    gst_rate_bps: 0,
    cgst_minor: 0,
    sgst_minor: 0,
    tax_minor: 0,
    total_minor: 10_000_000,
  },
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
    apiMock.cancelBooking.mockResolvedValue(booking({ status: 'CANCELLED' }));
    apiMock.completeBooking.mockResolvedValue(booking({ status: 'COMPLETED' }));
    apiMock.listPhotos.mockResolvedValue([]);
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
    expect(screen.getByText('Balance:')).toBeTruthy();
  });

  it('offers only the actions the current state allows', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    // Confirming is no longer a manual action — it's a side effect of the
    // first payment above zero, so no "Confirm booking" button exists at all.
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeTruthy();
  });

  it('does not offer editing a completed booking without the edit_locked override', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'COMPLETED' }));
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByRole('link', { name: 'Edit booking' })).toBeNull();
  });

  it('deletes a draft after asking, then leaves for the calendar', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete'];
    apiMock.deleteBooking.mockResolvedValue(undefined);
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    fireEvent.click(screen.getByRole('button', { name: 'Delete booking' }));
    expect(apiMock.deleteBooking).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete booking' }));
    await waitFor(() => expect(apiMock.deleteBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/banquet/calendar'));
  });

  it.each(['CONFIRMED', 'COMPLETED'] as const)(
    'offers deleting a %s booking only with the edit_locked override',
    async (status) => {
      apiMock.getBooking.mockResolvedValue(booking({ status }));
      branchPermissions = [...ALL_PERMS, 'banquet.booking.delete'];
      const { unmount } = render(<BookingDetailPage />);
      await screen.findByText('Meera Iyer');
      expect(screen.queryByRole('button', { name: 'Delete booking' })).toBeNull();
      unmount();

      branchPermissions = [...ALL_PERMS, 'banquet.booking.delete', 'banquet.booking.edit_locked'];
      render(<BookingDetailPage />);
      await screen.findByText('Meera Iyer');
      expect(screen.getByRole('button', { name: 'Delete booking' })).toBeTruthy();
    },
  );

  it('never offers deleting a cancelled booking, override or not', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CANCELLED' }));
    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete', 'banquet.booking.edit_locked'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Delete booking' })).toBeNull();
  });

  it('offers editing a completed booking to someone holding the edit_locked override', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'COMPLETED' }));
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update', 'banquet.booking.edit_locked'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByRole('link', { name: 'Edit booking' })).toBeTruthy();
  });

  it('offers verification only on unverified payments recorded by someone else', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.payment.verify'];
    apiMock.verifyPayment.mockResolvedValue({});
    const pay = (id: string, actor: string, verified: boolean) => ({
      id,
      booking_id: 'bk-1',
      amount_minor: 100_000,
      currency: 'INR',
      paid_at: '2037-01-01T10:00:00.000Z',
      method: 'cash',
      reference: null,
      kind: 'ADVANCE' as const,
      actor_user_id: actor,
      verification: verified ? { verified_by_user_id: 'u-x', verified_at: '', note: null } : null,
      reverses_id: null,
      reversed_by_id: null,
      active: true,
      created_at: '',
    });
    apiMock.getBooking.mockResolvedValue(
      booking({ status: 'CONFIRMED', payments: [pay('p-other', 'u-2', false), pay('p-mine', 'u-me', false), pay('p-done', 'u-2', true)] }),
    );
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    const buttons = screen.getAllByRole('button', { name: /^Verify payment/ });
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByText('Verified')).toHaveLength(1);
    expect(screen.getAllByText('Not verified')).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(apiMock.verifyPayment).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'p-other'),
    );
  });

  it('hides every mutation without the permissions', async () => {
    branchPermissions = ['banquet.view'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit booking' })).toBeNull();
  });

  it('cancels with the reason the operator gives', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.change(screen.getByLabelText('Reason for cancelling (optional)'), {
      target: { value: 'Client postponed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await waitFor(() =>
      expect(apiMock.cancelBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1', 'Client postponed'),
    );
  });

  it('shows times in the branch timezone as dd/MM/yyyy', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    // 12:00Z is 5:30 pm in Kolkata.
    expect(screen.getByText(/^20\/11\/2037, 5:30\s?pm$/i)).toBeTruthy();
  });
});

// ── booking edit ─────────────────────────────────────────────────────────────

describe('Banquet booking edit', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.getBooking.mockResolvedValue(booking());
    apiMock.getCustomer.mockResolvedValue({ id: 'c-1', company_id: 'co-1', name: 'Meera Iyer', phone: null, status: 'ACTIVE' });
    apiMock.listPackages.mockResolvedValue({ data: [], meta: { total: 0, limit: 100, offset: 0 } });
    apiMock.listPhotos.mockResolvedValue([]);
    apiMock.bookingPlateRequests.mockResolvedValue([]);
    apiMock.createPayment.mockResolvedValue({ payment: {}, balance: {} });
    apiMock.saveEventPlan.mockResolvedValue({});
    branchPermissions = [...ALL_PERMS];
    companyPermissions = [];
  });

  afterEach(() => {
    searchParams = new URLSearchParams();
  });

  it('adds another slot on the same day as a separate booking pre-filled from this one', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.create'];
    searchParams = new URLSearchParams('pick=add');
    apiMock.availability.mockResolvedValue({
      days: [{
        date: '2037-11-20',
        halls: [{
          hall_id: 'h-1',
          hall_name: 'Crystal',
          state: 'partial',
          slots: [
            { slot_id: 's-l', name: 'Lunch', starts_at: '2037-11-20T06:00:00.000Z', ends_at: '2037-11-20T10:30:00.000Z', state: 'booked', booking_ids: ['bk-1'] },
            { slot_id: 's-d', name: 'Dinner', starts_at: '2037-11-20T12:30:00.000Z', ends_at: '2037-11-20T17:30:00.000Z', state: 'available', booking_ids: [] },
          ],
        }],
      }],
    });
    apiMock.createBooking.mockResolvedValue(booking({ id: 'bk-2' }));
    render(<BookingEditPage />);

    // Fixed to the booking's own day: no day navigation in this mode.
    const sheet = await screen.findByRole('dialog', { name: 'Add another slot for this day' });
    expect(within(sheet).queryByRole('button', { name: /Next day/ })).toBeNull();
    // This booking's own slot is simply taken here, not "Keep".
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Select' }));

    await waitFor(() => expect(apiMock.createBooking).toHaveBeenCalled());
    expect(apiMock.createBooking.mock.calls[0][1]).toMatchObject({
      customer_id: 'c-1',
      hall_id: 'h-1',
      starts_at: '2037-11-20T12:30:00.000Z',
      guest_count: 80,
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/banquet/bk-2/edit'));
  });

  it('deletes a draft from the edit screen after asking, then leaves for the calendar', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete'];
    apiMock.deleteBooking.mockResolvedValue(undefined);
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.click(screen.getByRole('button', { name: 'Delete booking' }));
    expect(apiMock.deleteBooking).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete booking' }));
    await waitFor(() => expect(apiMock.deleteBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/banquet/calendar'));
  });

  it('offers deleting a confirmed, advance-paid booking from the edit screen only with the edit_locked override', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED', paid_minor: 500_000 }));
    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete'];
    const { unmount } = render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Delete booking' })).toBeNull();
    unmount();

    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete', 'banquet.booking.edit_locked'];
    apiMock.deleteBooking.mockResolvedValue(undefined);
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: 'Delete booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete booking' }));
    await waitFor(() => expect(apiMock.deleteBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1'));
  });

  it('offers deleting a completed, advance-paid booking from the edit screen with the edit_locked override', async () => {
    // A completed booking is only reachable on the edit screen at all with
    // the same override — see "offers editing a completed booking...".
    apiMock.getBooking.mockResolvedValue(booking({ status: 'COMPLETED', paid_minor: 500_000 }));
    branchPermissions = [...ALL_PERMS, 'banquet.booking.delete', 'banquet.booking.edit_locked'];
    apiMock.deleteBooking.mockResolvedValue(undefined);
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: 'Delete booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete booking' }));
    await waitFor(() => expect(apiMock.deleteBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1'));
  });

  it('moves a booking to any date picked straight from the calendar input', async () => {
    searchParams = new URLSearchParams('pick=move');
    apiMock.availability.mockResolvedValue({ days: [{ date: '2037-12-24', halls: [] }] });
    render(<BookingEditPage />);
    const sheet = await screen.findByRole('dialog', { name: 'Move to' });
    fireEvent.change(within(sheet).getByLabelText('Go to date'), { target: { value: '2037-12-24' } });
    await waitFor(() =>
      expect(apiMock.availability).toHaveBeenLastCalledWith(expect.anything(), { from: '2037-12-24', to: '2037-12-24' }),
    );
  });

  it('stages a payment without recording it, then sends it as whole minor units only when the booking is saved', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    apiMock.updateBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '25000.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stage payment' }));

    // Not sent yet — staged locally, and the totals shown are untouched.
    expect(apiMock.createPayment).not.toHaveBeenCalled();
    expect(screen.getByText(/pending — tap Update Booking/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Update Booking' }));
    await waitFor(() => expect(apiMock.createPayment).toHaveBeenCalled());
    expect(apiMock.createPayment.mock.calls[0][2]).toEqual({
      amount_minor: 2_500_050,
      currency: 'INR',
    });
  });

  it('lets a staged payment be removed before it is ever sent', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stage payment' }));
    expect(screen.getByText(/pending — tap Update Booking/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove pending payment' }));
    expect(screen.queryByText(/pending — tap Update Booking/)).toBeNull();
    // Nothing left to save, so Update Booking is disabled again.
    expect((screen.getByRole('button', { name: 'Update Booking' }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiMock.createPayment).not.toHaveBeenCalled();
    expect(apiMock.updateBooking).not.toHaveBeenCalled();
  });

  it('refuses to stage an unparseable or excessive amount', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    const field = screen.getByLabelText('Amount (INR)');
    const submit = () => screen.getByRole('button', { name: 'Stage payment' }) as HTMLButtonElement;

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
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Stage payment' })).toBeNull();
  });

  it('says a verified payment becomes permanent', async () => {
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: /Payment History/ }));
    expect(screen.getByText(/becomes a permanent record/i)).toBeTruthy();
  });

  it('corrects an unverified payment by reversing it and recording a fresh one', async () => {
    branchPermissions = [...ALL_PERMS];
    apiMock.updatePayment.mockResolvedValue({});
    apiMock.getBooking.mockResolvedValue(
      booking({
        status: 'CONFIRMED',
        payments: [
          {
            id: 'p-1', booking_id: 'bk-1', amount_minor: 500_000, currency: 'INR',
            paid_at: '2037-01-01T10:00:00.000Z', method: 'cash', reference: null, kind: 'ADVANCE',
            actor_user_id: 'u-2', verification: null, reverses_id: null, reversed_by_id: null, active: true,
            created_at: '',
          },
        ],
      }),
    );
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: /Payment History/ }));

    fireEvent.click(screen.getByRole('button', { name: /^Edit payment of/ }));
    const field = screen.getByLabelText(/Corrected amount/);
    fireEvent.change(field, { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMock.updatePayment).toHaveBeenCalled());
    expect(apiMock.updatePayment.mock.calls[0][1]).toBe('bk-1');
    expect(apiMock.updatePayment.mock.calls[0][2]).toBe('p-1');
    expect(apiMock.updatePayment.mock.calls[0][3]).toEqual({ amount_minor: 300_000, method: 'cash' });
  });

  it('offers no correction on a verified payment', async () => {
    branchPermissions = [...ALL_PERMS];
    apiMock.getBooking.mockResolvedValue(
      booking({
        status: 'CONFIRMED',
        payments: [
          {
            id: 'p-1', booking_id: 'bk-1', amount_minor: 500_000, currency: 'INR',
            paid_at: '2037-01-01T10:00:00.000Z', method: 'cash', reference: null, kind: 'ADVANCE',
            actor_user_id: 'u-2',
            verification: { verified_by_user_id: 'u-3', verified_at: '', note: null },
            reverses_id: null, reversed_by_id: null, active: true,
            created_at: '',
          },
        ],
      }),
    );
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: /Payment History/ }));
    expect(screen.queryByRole('button', { name: /^Edit payment of/ })).toBeNull();
  });

  it('saves the event plan', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.click(screen.getByRole('button', { name: /Additional Information/ }));
    fireEvent.change(screen.getByLabelText('Event Management (Optional)'), { target: { value: 'No nuts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMock.saveEventPlan).toHaveBeenCalled());
    expect(apiMock.saveEventPlan.mock.calls[0][2]).toMatchObject({ kitchen_notes: 'No nuts' });
  });

  it('shows GST as split CGST/SGST, and a no-GST booking as not applied', async () => {
    apiMock.getBooking.mockResolvedValue(
      booking({
        gst_rate_bps: 500,
        total_amount_minor: 10_500_000,
        invoice: { ...booking().invoice, gst_rate_bps: 500, cgst_minor: 250_000, sgst_minor: 250_000, tax_minor: 500_000, total_minor: 10_500_000 },
      }),
    );
    const { unmount } = render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.getByText('CGST:')).toBeTruthy();
    expect(screen.getByText('SGST:')).toBeTruthy();
    unmount();

    apiMock.getBooking.mockResolvedValue(booking());
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.getByText('Not applied')).toBeTruthy();
  });

  it('applies an admin discount as a whole-minor amount', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.discount.admin'];
    apiMock.addAdjustment.mockResolvedValue(booking());
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    expect(screen.getByRole('button', { name: 'Amount (₹)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Percentage (%)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Per Head (₹)' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Discount Amount'), { target: { value: '500.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Discount' }));

    await waitFor(() => expect(apiMock.addAdjustment).toHaveBeenCalled());
    expect(apiMock.addAdjustment.mock.calls[0][2]).toEqual({
      kind: 'ADMIN_DISCOUNT',
      description: 'Admin discount',
      amount_minor: 50_050,
    });
  });

  it('computes a percentage discount from the taxable value', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.discount.admin'];
    apiMock.addAdjustment.mockResolvedValue(booking());
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.click(screen.getByRole('button', { name: 'Percentage (%)' }));
    fireEvent.change(screen.getByLabelText('Discount Percentage'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Discount' }));

    await waitFor(() => expect(apiMock.addAdjustment).toHaveBeenCalled());
    // 10% of the ₹100,000.00 taxable value.
    expect(apiMock.addAdjustment.mock.calls[0][2]).toEqual({
      kind: 'ADMIN_DISCOUNT',
      description: '10% discount',
      amount_minor: 1_000_000,
    });
  });

  it('withdraws a charge through its reversal, and shows a withdrawn line without a button', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.charge.manage'];
    apiMock.reverseAdjustment.mockResolvedValue(booking());
    apiMock.getBooking.mockResolvedValue(
      booking({
        adjustments: [
          { id: 'a-1', kind: 'EXTRA_CHARGE', description: 'DJ', amount_minor: 500_000, reverses_id: null, reversed_by_id: null, active: true, actor_user_id: 'u-1', created_at: '' },
          { id: 'a-2', kind: 'EXTRA_CHARGE', description: 'Lights', amount_minor: 100_000, reverses_id: null, reversed_by_id: 'a-3', active: false, actor_user_id: 'u-1', created_at: '' },
          { id: 'a-3', kind: 'EXTRA_CHARGE', description: 'Withdrawn: Lights', amount_minor: 100_000, reverses_id: 'a-2', reversed_by_id: null, active: false, actor_user_id: 'u-1', created_at: '' },
        ],
      }),
    );
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    fireEvent.click(screen.getByRole('button', { name: 'Extra Charges' }));
    expect(screen.getAllByRole('button', { name: /^Withdraw / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw DJ' }));
    await waitFor(() =>
      expect(apiMock.reverseAdjustment).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1', 'a-1'),
    );
  });

  it('keeps discounts and charges out of reach on a started event without the past-edit permission', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update', 'banquet.charge.manage', 'banquet.discount.admin'];
    const started = booking({ status: 'CONFIRMED', starts_at: '2020-01-01T10:00:00.000Z', ends_at: '2020-01-01T16:00:00.000Z' });
    apiMock.getBooking.mockResolvedValue(started);
    const { unmount } = render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.getByText(/already started/)).toBeTruthy();
    expect(screen.queryByText('Admin Discount')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Extra Charges' })).toBeNull();
    unmount();

    branchPermissions = [...branchPermissions, 'banquet.booking.edit_past'];
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.queryByText(/already started/)).toBeNull();
    expect(screen.getByText('Admin Discount')).toBeTruthy();
  });

  it('sends only what changed', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update'];
    apiMock.updateBooking.mockResolvedValue(booking({ guest_count: 90 }));
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Number of Guests (PAX) *'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Booking' }));

    await waitFor(() => expect(apiMock.updateBooking).toHaveBeenCalled());
    expect(apiMock.updateBooking.mock.calls[0][2]).toEqual({ guest_count: 90 });
  });

  describe('leaving with unsaved changes', () => {
    const LEAVE = /You are about to leave this page/;

    beforeEach(() => {
      branchPermissions = [...ALL_PERMS, 'banquet.booking.update'];
      router.push.mockClear();
    });

    it('goes straight back when nothing was changed', async () => {
      render(<BookingEditPage />);
      await screen.findByDisplayValue('Meera Iyer');
      fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));
      expect(screen.queryByText(LEAVE)).toBeNull();
    });

    it('asks first, and Discard leaves without saving', async () => {
      render(<BookingEditPage />);
      await screen.findByDisplayValue('Meera Iyer');
      fireEvent.change(screen.getByLabelText('Number of Guests (PAX) *'), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));

      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByText(LEAVE)).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
      expect(router.push).toHaveBeenCalledWith('/banquet/bk-1');
      expect(apiMock.updateBooking).not.toHaveBeenCalled();
    });

    it('Save saves the changes, then leaves', async () => {
      apiMock.updateBooking.mockResolvedValue(booking({ guest_count: 90 }));
      render(<BookingEditPage />);
      await screen.findByDisplayValue('Meera Iyer');
      fireEvent.change(screen.getByLabelText('Number of Guests (PAX) *'), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/banquet/bk-1'));
      expect(apiMock.updateBooking.mock.calls[0][2]).toEqual({ guest_count: 90 });
    });

    it('stays on the page with the reason when saving fails', async () => {
      apiMock.updateBooking.mockRejectedValue(new Error('That hall is already booked for an overlapping time.'));
      render(<BookingEditPage />);
      await screen.findByDisplayValue('Meera Iyer');
      fireEvent.change(screen.getByLabelText('Number of Guests (PAX) *'), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/already booked/);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  it('updates the customer record when the name or phone changes', async () => {
    branchPermissions = [...ALL_PERMS];
    companyPermissions = ['customers.update'];
    apiMock.updateCustomer.mockResolvedValue({});
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');

    fireEvent.change(screen.getByLabelText('Customer Name *'), { target: { value: 'Meera Nair' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Booking' }));

    await waitFor(() => expect(apiMock.updateCustomer).toHaveBeenCalled());
    expect(apiMock.updateCustomer.mock.calls[0][1]).toBe('c-1');
    expect(apiMock.updateCustomer.mock.calls[0][2]).toEqual({ name: 'Meera Nair', phone: null });
  });

  it('refuses to edit a completed or cancelled booking', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'COMPLETED' }));
    render(<BookingEditPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/can no longer be edited/i)).toBeTruthy();
  });
});

// ── printable documents ──────────────────────────────────────────────────────

describe('Plate requests on a booking', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: 'pr-1',
    booking_id: 'bk-1',
    hall_name: 'Crystal',
    event_starts_at: '2037-11-20T12:00:00.000Z',
    item: { id: 'i-1', name: 'Paneer Tikka' },
    plates: 30,
    note: null,
    status: 'REJECTED',
    requested_at: '2037-11-20T13:00:00.000Z',
    requested_by: { id: 'u-me', name: 'Me' },
    decided_at: '2037-11-20T13:05:00.000Z',
    decided_by: { id: 'u-chef', name: 'Kabir' },
    rejection_reason: 'Out of paneer',
    dispatched_at: null,
    dispatched_by: null,
    ...over,
  });

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = [...ALL_PERMS, 'banquet.plate.request'];
    apiMock.getBooking.mockResolvedValue(booking({ status: 'CONFIRMED' }));
    apiMock.getCustomer.mockResolvedValue({ id: 'c-1', company_id: 'co-1', name: 'Meera Iyer', phone: null, status: 'ACTIVE' });
    apiMock.listPackages.mockResolvedValue({ data: [], meta: { total: 0, limit: 100, offset: 0 } });
    apiMock.listPhotos.mockResolvedValue([]);
    apiMock.bookingPlateRequests.mockResolvedValue([request()]);
    apiMock.requestPlates.mockResolvedValue(request({ id: 'pr-2', status: 'REQUESTED', decided_by: null, rejection_reason: null }));
  });

  it('lists the kitchen’s answers, and requests plates of a dish on this booking', async () => {
    render(<BookingEditPage />);
    const list = await screen.findByRole('list', { name: 'Plate requests for this booking' });
    expect(list.textContent).toMatch('30 × Paneer Tikka');
    expect(list.textContent).toMatch('Rejected');
    expect(list.textContent).toMatch('Out of paneer');

    fireEvent.change(screen.getByLabelText('Dish'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('Plates'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Head table' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Kitchen Order' }));
    await waitFor(() =>
      expect(apiMock.requestPlates).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1', {
        item_id: 'i-1',
        plates: 12,
        note: 'Head table',
      }),
    );
    expect(await screen.findByText('Plate request sent to the kitchen.')).toBeTruthy();
  });

  it('refuses a plate count the API would refuse, before sending it', async () => {
    render(<BookingEditPage />);
    await screen.findByRole('list', { name: 'Plate requests for this booking' });
    fireEvent.change(screen.getByLabelText('Dish'), { target: { value: 'i-1' } });
    for (const bad of ['0', '10001', '2.5', '']) {
      fireEvent.change(screen.getByLabelText('Plates'), { target: { value: bad } });
      expect((screen.getByRole('button', { name: 'Place Kitchen Order' }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(apiMock.requestPlates).not.toHaveBeenCalled();
  });

  it('offers no request form without banquet.plate.request, or for an event that is not confirmed', async () => {
    branchPermissions = [...ALL_PERMS];
    const { unmount } = render(<BookingEditPage />);
    await screen.findByRole('list', { name: 'Plate requests for this booking' });
    expect((screen.getByRole('button', { name: 'Place Kitchen Order' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    branchPermissions = [...ALL_PERMS, 'banquet.plate.request'];
    apiMock.getBooking.mockResolvedValue(booking({ status: 'DRAFT' }));
    apiMock.bookingPlateRequests.mockResolvedValue([]);
    render(<BookingEditPage />);
    await screen.findByDisplayValue('Meera Iyer');
    expect(screen.queryByRole('button', { name: 'Place Kitchen Order' })).toBeNull();
  });
});

describe('Banquet bill and KOT', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = [...ALL_PERMS];
  });

  const bill = (over: Partial<BanquetBookingDetail> = {}, terms: string | null = null) => ({
    booking: booking(over),
    branch: {
      id: 'br-1',
      name: 'Alpha Main',
      timezone: 'Asia/Kolkata',
      gstin: '27AAPFU0939F1ZV',
      fssai_license: '11521999000123',
      banquet_terms: terms,
    },
  });

  it('prints the branch terms and conditions at the foot of the bill, and nothing when there are none', async () => {
    apiMock.getBill.mockResolvedValue(bill({ status: 'CONFIRMED' }, 'Advance is non-refundable.\nMusic stops at 23:00.'));
    const { unmount } = render(<BillPage />);
    const terms = await screen.findByRole('region', { name: 'Terms and conditions' });
    expect(terms.textContent).toMatch('Advance is non-refundable.');
    expect(terms.textContent).toMatch('Music stops at 23:00.');
    unmount();

    apiMock.getBill.mockResolvedValue(bill({ status: 'CONFIRMED' }));
    render(<BillPage />);
    await screen.findByRole('article', { name: 'Bill' });
    expect(screen.queryByRole('region', { name: 'Terms and conditions' })).toBeNull();
  });

  it('prints a confirmed bill with the branch GSTIN and FSSAI licence', async () => {
    apiMock.getBill.mockResolvedValue(bill({ status: 'CONFIRMED' }));
    render(<BillPage />);
    const sheet = await screen.findByRole('article', { name: 'Bill' });
    expect(sheet.textContent).toMatch(/GSTIN: 27AAPFU0939F1ZV/);
    expect(sheet.textContent).toMatch(/FSSAI Lic\. No\.: 11521999000123/);
    expect(sheet.textContent).toMatch(/BANQUET BILL/);
    expect(sheet.textContent).toMatch(/Balance due/);
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  it('prints a draft as a quotation, never as a bill', async () => {
    apiMock.getBill.mockResolvedValue(bill({ status: 'DRAFT' }));
    render(<BillPage />);
    const sheet = await screen.findByRole('article', { name: 'Bill' });
    expect(sheet.textContent).toMatch(/QUOTATION — NOT CONFIRMED/);
    expect(sheet.textContent).not.toMatch(/BANQUET BILL/);
  });

  it('the KOT says it is not a bill and carries no money and no customer', async () => {
    apiMock.getBooking.mockResolvedValue(
      booking({ status: 'CONFIRMED', extra_pax: 10, event_plan: { id: 'ep', booking_id: 'bk-1', service_at: null, setup_notes: null, kitchen_notes: 'No nuts', created_at: '', updated_at: '' } }),
    );
    render(<KotPage />);
    const sheet = await screen.findByRole('article', { name: 'Kitchen order ticket' });
    const text = sheet.textContent ?? '';
    expect(text).toMatch('NOT A BILL - KITCHEN ONLY');
    expect(text).toMatch('Plates: 90');
    expect(text).toMatch('Paneer Tikka');
    expect(text).toMatch('No nuts');
    expect(text).not.toMatch(/Meera|₹|INR|total|balance/i);
  });

  it('refuses a KOT for a draft instead of printing one', async () => {
    apiMock.getBooking.mockResolvedValue(booking({ status: 'DRAFT' }));
    render(<KotPage />);
    expect(await screen.findByText(/only for a confirmed event/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
  });
});

// ── availability calendar ────────────────────────────────────────────────────

describe('Banquet availability', () => {
  /** 2026-09-16 is a Wednesday; the fixtures below sit in that week. */
  const TODAY = new Date('2026-09-16T06:00:00.000Z');

  const hallDay = (over = {}) => ({
    hall_id: 'h-1',
    hall_name: 'Crown Hall',
    state: 'partial',
    slots: [],
    confirmed_booking_ids: [],
    draft_booking_ids: [],
    ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TODAY);
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = ['banquet.view'];
    apiMock.availability.mockImplementation(async (_ctx, params) => ({
      branch_id: 'br-1',
      timezone: 'Asia/Kolkata',
      from: params.from,
      to: params.to,
      days: [
        {
          date: '2026-09-17',
          halls: [
            hallDay({
              state: 'full',
              slots: [
                { slot_id: 's-1', name: 'Lunch', starts_at: '2026-09-17T06:00:00.000Z', ends_at: '', state: 'booked', booking_ids: ['bk-1'] },
                { slot_id: 's-2', name: 'Dinner', starts_at: '2026-09-17T13:30:00.000Z', ends_at: '', state: 'tentative', booking_ids: ['bk-2'] },
              ],
              confirmed_booking_ids: ['bk-1'],
              draft_booking_ids: ['bk-2'],
            }),
          ],
        },
        {
          date: '2026-09-18',
          halls: [
            hallDay({
              state: 'available',
              slots: [
                { slot_id: 's-1', name: 'Lunch', starts_at: '2026-09-18T06:00:00.000Z', ends_at: '', state: 'available', booking_ids: [] },
                { slot_id: 's-2', name: 'Dinner', starts_at: '2026-09-18T13:30:00.000Z', ends_at: '', state: 'available', booking_ids: [] },
              ],
            }),
          ],
        },
      ],
    }));
    apiMock.listBookings.mockResolvedValue({
      data: [
        booking({
          id: 'bk-1',
          status: 'CONFIRMED',
          customer: { id: 'c-1', name: 'Praveen' },
          guest_count: 120,
          extra_pax: 0,
          hall_name: 'Crown Hall',
          starts_at: '2026-09-17T06:00:00.000Z',
        }),
        booking({
          id: 'bk-2',
          status: 'DRAFT',
          customer: { id: 'c-2', name: 'Nirmal' },
          guest_count: 150,
          extra_pax: 0,
          hall_name: 'Crown Hall',
          starts_at: '2026-09-17T13:30:00.000Z',
        }),
      ],
      meta: { total: 2, limit: 200, offset: 0 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the month, tinted by what each day holds, with a legend', async () => {
    render(<CalendarPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Banquet Availability' })).toBeTruthy();
    expect(screen.getByText('Banquet › Booking')).toBeTruthy();

    const grid = screen.getByRole('list', { name: /September 2026 availability/ });
    // The state is in the accessible name, so it never rests on colour alone.
    expect(within(grid).getByRole('button', { name: /17 Sep: Fully booked/ })).toBeTruthy();
    expect(within(grid).getByRole('button', { name: /18 Sep: Available/ })).toBeTruthy();
    expect(within(grid).getByRole('button', { name: /16 Sep: .*, today/ })).toBeTruthy();

    for (const label of ['Available', 'Partial', 'Fully Booked', 'Today']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('asks the server for the whole visible month, and moves a month at a time', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(apiMock.availability).toHaveBeenCalled());
    const first = apiMock.availability.mock.calls[0][1];
    expect(first).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() =>
      expect(apiMock.availability.mock.calls.at(-1)![1]).toMatchObject({ from: '2026-10-01', to: '2026-10-31' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() =>
      expect(apiMock.availability.mock.calls.at(-1)![1]).toMatchObject({ from: '2026-09-01', to: '2026-09-30' }),
    );
  });

  it('counts only the chosen type: a draft-only day is free for Upcoming', async () => {
    render(<CalendarPage />);
    const grid = () => screen.getByRole('list', { name: /September 2026 availability/ });
    await waitFor(() => expect(within(grid()).getByRole('button', { name: /17 Sep: Fully booked/ })).toBeTruthy());

    // Only the confirmed lunch counts, so the dinner slot is free again.
    fireEvent.change(screen.getByLabelText('Booking type'), { target: { value: 'upcoming' } });
    expect(within(grid()).getByRole('button', { name: /17 Sep: Partly booked/ })).toBeTruthy();

    // Only the draft counts.
    fireEvent.change(screen.getByLabelText('Booking type'), { target: { value: 'draft' } });
    expect(within(grid()).getByRole('button', { name: /17 Sep: Partly booked/ })).toBeTruthy();
  });

  it('opens the day sheet from a calendar day, showing halls and their slots', async () => {
    render(<CalendarPage />);
    const grid = screen.getByRole('list', { name: /September 2026 availability/ });
    fireEvent.click(await within(grid).findByRole('button', { name: /17 Sep: Fully booked/ }));

    const sheet = await screen.findByRole('dialog', { name: /Availability for September 17, 2026/ });
    expect(within(sheet).getByText('Crown Hall')).toBeTruthy();
    expect(within(sheet).getByText(/0 of 2 available/)).toBeTruthy();
    expect(within(sheet).getByText('Both')).toBeTruthy();
    expect(within(sheet).getByText('Dine-in buffets')).toBeTruthy();
  });

  it('moves a week at a time and returns to today', async () => {
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Weekly/ }));
    await screen.findByText('13 Sep - 19 Sep');

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText('20 Sep - 26 Sep')).toBeTruthy();
    await waitFor(() =>
      expect(apiMock.listBookings.mock.calls.at(-1)![1]).toMatchObject({ from: '2026-09-20', to: '2026-09-26', date_field: 'event' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('13 Sep - 19 Sep')).toBeTruthy();
  });

  it('shows the refusal instead of an empty grid when the load fails', async () => {
    apiMock.availability.mockRejectedValue(new Error('Forbidden'));
    render(<CalendarPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
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
    pathname = '/banquet/calendar';
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    const bar = screen.getByRole('navigation', { name: 'Banquet sections' });
    expect(within(bar).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Home',
      'Booking',
      'Chef',
      'KDS',
    ]);
    expect(within(bar).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
  });

  it('keeps Chef marked on an event\'s details screen beneath it', () => {
    pathname = '/banquet/kitchen/ev-1';
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    const bar = screen.getByRole('navigation', { name: 'Banquet sections' });
    expect(within(bar).getByRole('link', { name: 'Chef' }).getAttribute('aria-current')).toBe('page');
    expect(within(bar).getByRole('link', { name: 'KDS' }).getAttribute('aria-current')).toBeNull();
  });

  it('prefers an exact tab over a parent one', () => {
    pathname = '/queue/podium';
    render(
      <ScreenTabBar
        label="Queue screens"
        items={[
          { key: 'q', href: '/queue', tab: 'Queue', icon: 'queue', tone: 'blue' },
          { key: 'p', href: '/queue/podium', tab: 'Podium', icon: 'people', tone: 'green' },
        ]}
      />,
    );
    const bar = screen.getByRole('navigation', { name: 'Queue screens' });
    expect(within(bar).getByRole('link', { name: 'Podium' }).getAttribute('aria-current')).toBe('page');
    expect(within(bar).getByRole('link', { name: 'Queue' }).getAttribute('aria-current')).toBeNull();
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
    expect(screen.getByRole('status').textContent).toBe('Opening Chef…');
  });

  it('redirects /banquet to /banquet/calendar since bookings list is not a tab', () => {
    router.replace.mockReset();
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(router.replace).toHaveBeenCalledWith('/banquet/calendar');
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

  it('drops the Chef and KDS for someone without banquet.kds.view', () => {
    branchPermissions = ['banquet.view'];
    pathname = '/banquet/calendar';
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    const bar = screen.getByRole('navigation', { name: 'Banquet sections' });
    expect(within(bar).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Home',
      'Booking',
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
    apiMock.kitchenPlateRequests.mockResolvedValue({ service_date: '2027-11-20', requests: [] });
    branchPermissions = [...ALL_PERMS];
  });
  afterEach(() => vi.unstubAllGlobals());

  const plate = (over: Record<string, unknown> = {}) => ({
    id: 'pr-1',
    booking_id: 'bk-1',
    hall_name: 'Crystal',
    event_starts_at: '2027-11-20T12:00:00.000Z',
    item: { id: 'i-1', name: 'Paneer Tikka' },
    plates: 20,
    note: 'Table 4',
    status: 'REQUESTED',
    requested_at: '2027-11-20T13:10:00.000Z',
    requested_by: { id: 'u-server', name: 'Sam' },
    decided_at: null,
    decided_by: null,
    rejection_reason: null,
    dispatched_at: null,
    dispatched_by: null,
    ...over,
  });

  it('lists plate requests for the board’s day and approves one someone else asked for', async () => {
    apiMock.kitchenPlateRequests.mockResolvedValue({ service_date: '2027-11-20', requests: [plate()] });
    apiMock.approvePlates.mockResolvedValue(plate({ status: 'APPROVED' }));
    render(<KdsPage />);
    const open = await screen.findByRole('list', { name: 'Open plate requests' });
    expect(open.textContent).toMatch('20 × Paneer Tikka');
    expect(open.textContent).toMatch('asked by Sam');
    expect(apiMock.kitchenPlateRequests).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, '2027-11-20');

    fireEvent.click(screen.getByRole('button', { name: 'Approve 20 plates of Paneer Tikka' }));
    await waitFor(() => expect(apiMock.approvePlates).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'pr-1'));
    await waitFor(() => expect(apiMock.kdsBoard).toHaveBeenCalledTimes(2));
  });

  it('never offers a decision on your own request', async () => {
    apiMock.kitchenPlateRequests.mockResolvedValue({
      service_date: '2027-11-20',
      requests: [plate({ requested_by: { id: 'u-me', name: 'Me' } })],
    });
    render(<KdsPage />);
    await screen.findByRole('list', { name: 'Open plate requests' });
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject/ })).toBeNull();
    expect(screen.getByText(/another cook decides/)).toBeTruthy();
  });

  it('rejects only with a reason, and dispatches approved plates', async () => {
    apiMock.kitchenPlateRequests.mockResolvedValue({
      service_date: '2027-11-20',
      requests: [plate(), plate({ id: 'pr-2', status: 'APPROVED', item: { id: 'i-2', name: 'Dal' }, plates: 5 })],
    });
    apiMock.rejectPlates.mockResolvedValue(plate({ status: 'REJECTED' }));
    apiMock.dispatchPlates.mockResolvedValue(plate({ id: 'pr-2', status: 'DISPATCHED' }));
    render(<KdsPage />);
    await screen.findByRole('list', { name: 'Open plate requests' });

    fireEvent.click(screen.getByRole('button', { name: 'Reject 20 plates of Paneer Tikka' }));
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: ' Out of paneer ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(apiMock.rejectPlates).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'pr-1', 'Out of paneer'));

    // The board is busy until the rejection has been reconciled; a click before then is ignored.
    const dispatch = () => screen.getByRole('button', { name: 'Dispatch 5 plates of Dal' }) as HTMLButtonElement;
    await waitFor(() => expect(dispatch().disabled).toBe(false));
    fireEvent.click(dispatch());
    await waitFor(() => expect(apiMock.dispatchPlates).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'pr-2'));
  });

  it('shows plate requests read-only without banquet.kds.manage, and says why a list failed', async () => {
    branchPermissions = ['banquet.kds.view'];
    apiMock.kitchenPlateRequests.mockResolvedValue({ service_date: '2027-11-20', requests: [plate({ status: 'APPROVED' })] });
    const { unmount } = render(<KdsPage />);
    await screen.findByRole('list', { name: 'Open plate requests' });
    expect(screen.queryByRole('button', { name: /^Dispatch/ })).toBeNull();
    unmount();

    apiMock.kitchenPlateRequests.mockRejectedValue(new Error('Forbidden'));
    render(<KdsPage />);
    expect((await screen.findAllByRole('alert')).some((a) => /Forbidden/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.queryByText('No plate requests for this day.')).toBeNull();
  });

  it('shows the events, the kitchen notes and the customer', async () => {
    render(<KdsPage />);
    expect(await screen.findByText('Crystal')).toBeTruthy();
    expect(screen.getByText('Paneer Tikka')).toBeTruthy();
    expect(screen.getByText('No nuts')).toBeTruthy();
    expect(screen.getByText(/Meera Iyer/)).toBeTruthy();
  });

  it('advances an item and reconciles', async () => {
    render(<KdsPage />);
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
    render(<KdsPage />);
    await screen.findByText('Crystal');
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    apiMock.kdsBoard.mockResolvedValue(
      staffBoard({ counts: { events: 9, pending: 0, in_progress: 0, ready: 0 } }),
    );

    FakeEventSource.last()!.emit('banquet.item.updated', { id: 'bk-1' });
    await waitFor(() => expect(screen.getByText(/9 events/)).toBeTruthy());
  });

  it('puts only the ticket in the stream URL', async () => {
    render(<KdsPage />);
    await waitFor(() => expect(FakeEventSource.last()).toBeDefined());
    const url = FakeEventSource.last()!.url;
    expect(url).toContain(`ticket=${'a'.repeat(64)}`);
    expect(url).not.toContain('Bearer');
  });

  it('hides the advance buttons without banquet.kds.manage', async () => {
    branchPermissions = ['banquet.view', 'banquet.kds.view'];
    render(<KdsPage />);
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

// ── new booking ──────────────────────────────────────────────────────────────

/**
 * This quick form collects no payment, so every booking it creates stays a
 * draft — confirming (and locking the hall) is a side effect of the first
 * payment above zero, recorded later from the booking's own page.
 */
describe('New booking', () => {
  const page = <T,>(data: T[]) => ({ data, meta: { total: data.length, limit: 100, offset: 0 } });

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    apiMock.listBookings.mockResolvedValue(page([]));
    apiMock.listHalls.mockResolvedValue(page([{ id: 'h-1', name: 'Crystal', capacity: 200, status: 'ACTIVE' }]));
    apiMock.listPackages.mockResolvedValue(
      page([{ id: 'p-1', name: 'Gold Veg', price_per_guest_minor: 125_000, currency: 'INR', status: 'ACTIVE' }]),
    );
    apiMock.customers.mockResolvedValue(page([{ id: 'c-1', name: 'Meera Iyer', status: 'ACTIVE' }]));
    apiMock.createBooking.mockResolvedValue(booking({ id: 'bk-new', guest_count: 80 }));
    branchPermissions = ['banquet.view', 'banquet.booking.create'];
    companyPermissions = ['customers.view'];
    selectedBranchId = 'br-1';
    pathname = '/banquet';
  });

  async function fillForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'New booking' }));
    await screen.findByRole('option', { name: 'Crystal · seats 200' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByLabelText('Hall'), { target: { value: 'h-1' } });
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2027-11-20T12:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2027-11-20T18:00' } });
  }

  it('Create draft never confirms', async () => {
    render(<BookingsPage />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText(/Draft booking created for 80 guests/)).toBeTruthy();
    expect(apiMock.createBooking).toHaveBeenCalledTimes(1);
    // The create request itself carries no status — the server decides it from payment.
    expect(apiMock.createBooking.mock.calls[0][1]).not.toHaveProperty('status');
  });

  it('sends extra pax and no-GST mode, but never a tax rate or status', async () => {
    render(<BookingsPage />);
    await fillForm();
    fireEvent.change(screen.getByLabelText('Extra pax'), { target: { value: '15' } });
    fireEvent.click(screen.getByLabelText('Apply the branch GST rate'));
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => expect(apiMock.createBooking).toHaveBeenCalled());
    const body = apiMock.createBooking.mock.calls[0][1];
    expect(body).toMatchObject({ extra_pax: 15, apply_gst: false, guest_count: 50 });
    expect(body).not.toHaveProperty('gst_rate_bps');
    // 12:00 in Kolkata, not in the device zone.
    expect(body.starts_at).toBe('2027-11-20T06:30:00.000Z');
  });

  it('filters by tab, payment state and search', async () => {
    render(<BookingsPage />);
    await screen.findByText('No bookings yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: 'drafts' })));
    fireEvent.change(screen.getByLabelText('Filter by payment'), { target: { value: 'pending' } });
    await waitFor(() =>
      expect(apiMock.listBookings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tab: 'drafts', payment: 'pending' })),
    );
    fireEvent.change(screen.getByLabelText('Search bookings'), { target: { value: '  meera ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(apiMock.listBookings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ q: 'meera' })),
    );
    expect(await screen.findByText('No bookings match these filters.')).toBeTruthy();
  });

});

// ── chef display ─────────────────────────────────────────────────────────────

describe('Chef display', () => {
  const today = branchToday('Asia/Kolkata');
  const plus = (n: number) => addCalendarDays(today, n);
  const event = (over: Record<string, unknown> = {}) => ({
    id: 'ev-1',
    branch_id: 'br-1',
    date: today,
    customer_name: 'John',
    hall_name: 'Crown Hall',
    slot_name: 'Lunch',
    guest_count: 100,
    starts_at: `${today}T06:30:00.000Z`,
    ends_at: `${today}T09:30:00.000Z`,
    service_at: null,
    kitchen_notes: null,
    setup_notes: null,
    status: 'CONFIRMED',
    package_name: 'Silver',
    items: [{ id: 'i-1', name: 'Paneer tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null }],
    ...over,
  });
  const calendar = (bookings: unknown[]) => ({ branch_id: 'br-1', from: today, to: plus(6), timezone: 'Asia/Kolkata', bookings });

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = ['banquet.kds.view', 'banquet.view'];
    selectedBranchId = 'br-1';
    pathname = '/banquet/kitchen';
    apiMock.chefCalendar.mockResolvedValue(
      calendar([
        event(),
        event({ id: 'ev-2', date: plus(2), customer_name: 'Rajendran', slot_name: 'Dinner', package_name: '', items: [] }),
      ]),
    );
  });

  it('shows a week from today, a column per day, with each event\'s plates, hall and slot', async () => {
    render(<ChefPage />);
    const card = (await screen.findByText('John')).closest('article')!;
    expect(apiMock.chefCalendar).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, { from: today, to: plus(6) });
    expect(within(card).getByText('100 pax')).toBeTruthy();
    expect(within(card).getByText('Crown Hall')).toBeTruthy();
    expect(within(card).getByText('Lunch')).toBeTruthy();
    expect(screen.getByText('2 bookings')).toBeTruthy();
    // Seven day columns; a day without events says so.
    expect(document.querySelectorAll('section[aria-label]').length).toBe(7);
    expect(screen.getAllByText('No bookings').length).toBe(5);
  });

  it('opens View details as its own screen that knows the way back to this week', async () => {
    render(<ChefPage />);
    await screen.findByText('John');
    const link = screen.getByRole('link', { name: /^View details for John/ });
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/banquet/kitchen/ev-1');
    expect(href.searchParams.get('back')).toBe(`/banquet/kitchen?view=week&date=${today}`);
  });

  it('keeps the view and day in the address, and restores them from it', async () => {
    searchParams = new URLSearchParams(`view=month&date=${plus(2)}`);
    render(<ChefPage />);
    expect(await screen.findByText('Rajendran')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() =>
      expect(router.replace).toHaveBeenLastCalledWith(`/banquet/kitchen?view=month&date=${plus(2)}`, { scroll: false }),
    );
    searchParams = new URLSearchParams();
  });

  it('calls an event "Event" for someone who may not see who it is for', async () => {
    apiMock.chefCalendar.mockResolvedValue(calendar([event({ customer_name: null })]));
    render(<ChefPage />);
    expect(await screen.findByText('Event')).toBeTruthy();
  });

  it('switches to a month with a count per day, and lists the day tapped', async () => {
    render(<ChefPage />);
    await screen.findByText('John');
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));

    await waitFor(() =>
      expect(apiMock.chefCalendar).toHaveBeenLastCalledWith(expect.anything(), {
        from: `${today.slice(0, 7)}-01`,
        to: `${today.slice(0, 7)}-${String(daysInMonth(today)).padStart(2, '0')}`,
      }),
    );
    const dayCell = await screen.findByRole('button', { name: new RegExp(`^${Number(today.slice(8, 10))} \\w+, 1 booking$`) });
    expect(dayCell.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('John')).toBeTruthy();
  });

  describe('event details screen', () => {
    afterEach(() => {
      searchParams = new URLSearchParams();
    });

    it('shows the event full screen with its menu, and goes back to the week it came from', async () => {
      apiMock.chefEvent.mockResolvedValue(event());
      searchParams = new URLSearchParams(`back=${encodeURIComponent(`/banquet/kitchen?view=week&date=${today}`)}`);
      render(<ChefEventPage />);

      expect(await screen.findByRole('heading', { name: 'John', level: 1 })).toBeTruthy();
      expect(apiMock.chefEvent).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1');
      expect(screen.getByText('100 pax')).toBeTruthy();
      expect(screen.getByText(/^Lunch · /)).toBeTruthy();
      expect(screen.getByText('Menu — Silver')).toBeTruthy();
      expect(screen.getByText('Paneer tikka')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Back to Chef Display' }).getAttribute('href')).toBe(
        `/banquet/kitchen?view=week&date=${today}`,
      );
    });

    it('leaves the menu out when none was chosen', async () => {
      apiMock.chefEvent.mockResolvedValue(event({ customer_name: 'Rajendran', slot_name: 'Dinner', package_name: '', items: [] }));
      render(<ChefEventPage />);
      await screen.findByRole('heading', { name: 'Rajendran', level: 1 });
      expect(screen.queryByText(/^Menu/)).toBeNull();
    });

    it('never follows a back address outside the chef display', async () => {
      apiMock.chefEvent.mockResolvedValue(event());
      searchParams = new URLSearchParams('back=https://evil.example/');
      render(<ChefEventPage />);
      await screen.findByRole('heading', { name: 'John', level: 1 });
      expect(screen.getByRole('link', { name: 'Back to Chef Display' }).getAttribute('href')).toBe('/banquet/kitchen');
    });

    it('says why an event cannot be shown', async () => {
      apiMock.chefEvent.mockRejectedValue(new Error('Not Found'));
      render(<ChefEventPage />);
      expect((await screen.findByRole('alert')).textContent).toMatch(/Not Found/);
    });
  });

  it('moves a week at a time and comes back with Today', async () => {
    render(<ChefPage />);
    await screen.findByText('John');
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() =>
      expect(apiMock.chefCalendar).toHaveBeenLastCalledWith(expect.anything(), { from: plus(7), to: plus(13) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() =>
      expect(apiMock.chefCalendar).toHaveBeenLastCalledWith(expect.anything(), { from: today, to: plus(6) }),
    );
  });
});

// ── finance overview ─────────────────────────────────────────────────────────

describe('Banquet finance overview', () => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const today = branchToday('Asia/Kolkata');
  const ym = today.slice(0, 7);
  const [year, monthIdx] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const financeRow = (over: Record<string, unknown>) => ({
    id: 'f-1',
    customer_name: 'Ramesh',
    hall_name: 'Crystal',
    starts_at: '2026-09-18T06:00:00.000Z',
    guest_count: 180,
    extra_pax: 20,
    status: 'CONFIRMED',
    total_amount_minor: 10_000_000,
    paid_minor: 5_762_200,
    balance_minor: 4_237_800,
    remaining_minor: 4_237_800,
    payment_status: 'PARTIAL',
    currency: 'INR',
    ...over,
  });
  const finance = (bookings: unknown[]) => ({
    from: `${ym}-01`,
    to: `${ym}-${lastDay}`,
    currency: 'INR',
    total_bookings: bookings.length,
    confirmed_bookings: bookings.length,
    completed_bookings: 0,
    cancelled_bookings: 0,
    draft_bookings: 0,
    total_revenue_minor: 149_309_000,
    total_paid_minor: 144_839_600,
    total_outstanding_minor: 6_167_700,
    total_advance_minor: 0,
    billable_days: 1,
    bookings,
  });

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    // jsdom has no layout; the picker scrolls the selected month into view.
    Element.prototype.scrollIntoView = vi.fn();
    branchPermissions = ['banquet.finance.view'];
    selectedBranchId = 'br-1';
    pathname = '/banquet/finance';
    apiMock.finance.mockResolvedValue(
      finance([
        financeRow({}),
        financeRow({ id: 'f-2', customer_name: 'Swaminathan', guest_count: 90, extra_pax: 0, remaining_minor: -8_550_000, balance_minor: 0 }),
      ]),
    );
  });

  it('opens on the current month in the branch\'s days and shows whole-rupee totals', async () => {
    render(<FinancePage />);
    await screen.findByText('Ramesh');
    expect(apiMock.finance).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, { from: `${ym}-01`, to: `${ym}-${lastDay}` });
    expect(screen.getByText('₹1493090')).toBeTruthy();
    expect(screen.getByText('₹1448396')).toBeTruthy();
    expect(screen.getByText('₹61677')).toBeTruthy();
    expect(screen.getByLabelText('2 bookings')).toBeTruthy();
  });

  it('shows each booking\'s signed remaining: money due in red with the pending mark, overpaid in green', async () => {
    render(<FinancePage />);
    const due = (await screen.findByText('Ramesh')).closest('a')!;
    expect(due.getAttribute('href')).toBe('/banquet/f-1');
    expect(due.getAttribute('data-pending')).toBe('true');
    expect(within(due).getByText('₹42378')).toBeTruthy();
    // 180 + 20 extra pax, on the branch's own day.
    expect(within(due).getByText(/200 PAX\s+•\s+18 Sep, 2026/)).toBeTruthy();

    const over = screen.getByText('Swaminathan').closest('a')!;
    expect(over.getAttribute('data-pending')).toBe('false');
    expect(within(over).getByText('₹-85500')).toBeTruthy();
  });

  it('filters to pending payments with the switch', async () => {
    render(<FinancePage />);
    await screen.findByText('Ramesh');
    const toggle = screen.getByRole('switch', { name: 'Show Pending Payments Only' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(apiMock.finance).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ payment: 'pending' })),
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('picks a new range on the calendar and applies it only on Save', async () => {
    render(<FinancePage />);
    await screen.findByText('Ramesh');
    fireEvent.click(screen.getByRole('button', { name: /^Date range/ }));

    const picker = screen.getByRole('dialog', { name: 'Select range' });
    fireEvent.click(within(picker).getByLabelText(`10 ${MONTHS[monthIdx]} ${year}`));
    fireEvent.click(within(picker).getByLabelText(`24 ${MONTHS[monthIdx]} ${year}`));
    expect(within(picker).getByText(/10 – .* 24/)).toBeTruthy();
    const calls = apiMock.finance.mock.calls.length;

    fireEvent.click(within(picker).getByText('Save'));
    await waitFor(() =>
      expect(apiMock.finance).toHaveBeenLastCalledWith(expect.anything(), { from: `${ym}-10`, to: `${ym}-24` }),
    );
    expect(apiMock.finance.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole('dialog', { name: 'Select range' })).toBeNull();
  });

  it('keeps the old range when the picker is closed without saving', async () => {
    render(<FinancePage />);
    await screen.findByText('Ramesh');
    fireEvent.click(screen.getByRole('button', { name: /^Date range/ }));
    const picker = screen.getByRole('dialog', { name: 'Select range' });
    fireEvent.click(within(picker).getByLabelText(`10 ${MONTHS[monthIdx]} ${year}`));
    fireEvent.click(within(picker).getByLabelText('Close'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiMock.finance).toHaveBeenCalledTimes(1);
  });

  it('accepts typed dates from the pencil mode', async () => {
    render(<FinancePage />);
    await screen.findByText('Ramesh');
    fireEvent.click(screen.getByRole('button', { name: /^Date range/ }));
    const picker = screen.getByRole('dialog', { name: 'Select range' });
    fireEvent.click(within(picker).getByLabelText('Switch to typing the dates'));
    fireEvent.change(within(picker).getByLabelText('Start date'), { target: { value: '2026-08-01' } });
    fireEvent.change(within(picker).getByLabelText('End date'), { target: { value: '2026-08-31' } });
    fireEvent.click(within(picker).getByText('Save'));

    await waitFor(() =>
      expect(apiMock.finance).toHaveBeenLastCalledWith(expect.anything(), { from: '2026-08-01', to: '2026-08-31' }),
    );
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

  it('catalogue: adds a slot to a hall', async () => {
    branchPermissions = ['banquet.view', 'banquet.hall.manage'];
    apiMock.listHalls.mockResolvedValue({
      data: [{ id: 'h-1', branch_id: 'br-1', name: 'Crystal', capacity: 200, status: 'ACTIVE', slots: [], created_at: '', updated_at: '' }],
      meta: { total: 1, limit: 100, offset: 0 },
    });
    apiMock.createSlot.mockResolvedValue({});
    render(<CatalogPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add slot' }));
    fireEvent.change(screen.getByLabelText('Slot name'), { target: { value: 'Dinner' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '23:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save slot' }));
    await waitFor(() =>
      expect(apiMock.createSlot).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'h-1', {
        name: 'Dinner',
        start_time: '19:00',
        end_time: '23:30',
      }),
    );
  });

  it('catalogue: shows the refusal and claims neither list is empty', async () => {
    apiMock.listHalls.mockRejectedValue(new Error('Forbidden'));
    render(<CatalogPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');
    expect(screen.queryByText('No halls yet.')).toBeNull();
    expect(screen.queryByText('No packages yet.')).toBeNull();
  });
});

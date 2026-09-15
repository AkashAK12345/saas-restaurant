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
import CalendarPage from './(staff)/(app)/banquet/calendar/page';
import BillPage from './(staff)/(app)/banquet/[id]/bill/page';
import KotPage from './(staff)/(app)/banquet/[id]/kot/page';
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
    expect(screen.queryByRole('button', { name: 'Edit booking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
  });

  it('shows GST as equal CGST and SGST halves, and a no-GST booking plainly', async () => {
    apiMock.getBooking.mockResolvedValue(
      booking({
        gst_rate_bps: 500,
        total_amount_minor: 10_500_000,
        invoice: { ...booking().invoice, gst_rate_bps: 500, cgst_minor: 250_000, sgst_minor: 250_000, tax_minor: 500_000, total_minor: 10_500_000 },
      }),
    );
    const { unmount } = render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByText('CGST · 2.5%')).toBeTruthy();
    expect(screen.getByText('SGST · 2.5%')).toBeTruthy();
    unmount();

    apiMock.getBooking.mockResolvedValue(booking());
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByText('Not applied')).toBeTruthy();
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

  it('adds a discount in whole minor units, offering only the kinds the viewer may add', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.discount.apply'];
    apiMock.addAdjustment.mockResolvedValue(booking());
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    const kinds = Array.from((screen.getByLabelText('Line type') as HTMLSelectElement).options).map((o) => o.value);
    expect(kinds).toEqual(['', 'LINE_DISCOUNT', 'PER_HEAD_DISCOUNT']);

    fireEvent.change(screen.getByLabelText('Line type'), { target: { value: 'LINE_DISCOUNT' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Loyalty' } });
    fireEvent.change(screen.getByLabelText('Line amount (INR)'), { target: { value: '500.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));

    await waitFor(() => expect(apiMock.addAdjustment).toHaveBeenCalled());
    expect(apiMock.addAdjustment.mock.calls[0][2]).toEqual({
      kind: 'LINE_DISCOUNT',
      description: 'Loyalty',
      amount_minor: 50_050,
    });
  });

  it('withdraws a line through its reversal, and shows a withdrawn line without a button', async () => {
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
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getAllByRole('button', { name: /^Withdraw / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw DJ' }));
    await waitFor(() =>
      expect(apiMock.reverseAdjustment).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-1', 'a-1'),
    );
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

  it('keeps a started event read-only without the past-edit permission', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update', 'banquet.charge.manage'];
    const started = booking({ status: 'CONFIRMED', starts_at: '2020-01-01T10:00:00.000Z', ends_at: '2020-01-01T16:00:00.000Z' });
    apiMock.getBooking.mockResolvedValue(started);
    const { unmount } = render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.getByText(/already started/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit booking' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
    unmount();

    branchPermissions = [...branchPermissions, 'banquet.booking.edit_past'];
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    expect(screen.queryByText(/already started/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit booking' })).toBeTruthy();
  });

  it('edits send only what changed', async () => {
    branchPermissions = [...ALL_PERMS, 'banquet.booking.update'];
    apiMock.listHalls.mockResolvedValue({ data: [{ id: 'h-1', name: 'Crystal', capacity: 200, status: 'ACTIVE', slots: [] }], meta: { total: 1, limit: 100, offset: 0 } });
    apiMock.updateBooking.mockResolvedValue(booking({ guest_count: 90 }));
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');

    fireEvent.click(screen.getByRole('button', { name: 'Edit booking' }));
    await waitFor(() => expect(apiMock.listHalls).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Guaranteed guests'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(apiMock.updateBooking).toHaveBeenCalled());
    expect(apiMock.updateBooking.mock.calls[0][2]).toEqual({ guest_count: 90 });
  });

  it('shows times in the branch timezone as dd/MM/yyyy', async () => {
    render(<BookingDetailPage />);
    await screen.findByText('Meera Iyer');
    // 12:00Z is 5:30 pm in Kolkata.
    expect(screen.getByText(/^20\/11\/2037, 5:30\s?pm$/i)).toBeTruthy();
  });
});

// ── printable documents ──────────────────────────────────────────────────────

describe('Banquet bill and KOT', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = [...ALL_PERMS];
  });

  const bill = (over: Partial<BanquetBookingDetail> = {}) => ({
    booking: booking(over),
    branch: { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', gstin: '27AAPFU0939F1ZV', fssai_license: '11521999000123' },
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

describe('Banquet availability calendar', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    branchPermissions = ['banquet.view'];
    apiMock.listHalls.mockResolvedValue({ data: [], meta: { total: 0, limit: 100, offset: 0 } });
    apiMock.availability.mockImplementation(async (_ctx: unknown, params: { from: string; to: string }) => ({
      branch_id: 'br-1',
      timezone: 'Asia/Kolkata',
      from: params.from,
      to: params.to,
      days: [
        {
          date: params.from,
          halls: [
            {
              hall_id: 'h-1',
              hall_name: 'Crystal',
              state: 'partial',
              slots: [
                { slot_id: 's-1', name: 'Lunch', starts_at: '2028-03-15T05:30:00.000Z', ends_at: '', state: 'booked', booking_ids: ['bk-9'] },
                { slot_id: 's-2', name: 'Dinner', starts_at: '2028-03-15T13:30:00.000Z', ends_at: '', state: 'available', booking_ids: [] },
              ],
              confirmed_booking_ids: ['bk-9'],
              draft_booking_ids: [],
            },
          ],
        },
      ],
    }));
  });

  it('shows each slot state and links a booked slot to its booking', async () => {
    render(<CalendarPage />);
    expect(await screen.findByText('Partly booked')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lunch · Booked' }).getAttribute('href')).toBe('/banquet/bk-9');
    expect(screen.getByText(/Dinner .* · Free/)).toBeTruthy();
    // No customer data reaches the calendar.
    expect(document.body.textContent).not.toMatch(/Meera/);
  });

  it('asks the server for a branch-local week and moves by a week', async () => {
    render(<CalendarPage />);
    await screen.findByText('Partly booked');
    const first = apiMock.availability.mock.calls[0][1] as { from: string; to: string };
    expect(first.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(first.to) - Date.parse(first.from)) / 86_400_000;
    expect(days).toBe(6);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(apiMock.availability).toHaveBeenCalledTimes(2));
    const second = apiMock.availability.mock.calls[1][1] as { from: string };
    expect((Date.parse(second.from) - Date.parse(first.from)) / 86_400_000).toBe(7);
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
    render(
      <BanquetLayout>
        <p>child</p>
      </BanquetLayout>,
    );
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Bookings',
      'Calendar',
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
      'Calendar',
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

// ── new booking ──────────────────────────────────────────────────────────────

/**
 * A booking is always created as a draft; confirming is its own operation,
 * because that is where the server checks the hall is free. "Create & confirm"
 * runs both, for someone allowed to do both, and never loses the draft.
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
    apiMock.confirmBooking.mockResolvedValue(booking({ id: 'bk-new', status: 'CONFIRMED' }));
    branchPermissions = ['banquet.view', 'banquet.booking.create', 'banquet.booking.confirm'];
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

  it('Create & confirm creates the booking, then confirms that same booking', async () => {
    render(<BookingsPage />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create & confirm' }));

    await waitFor(() =>
      expect(apiMock.confirmBooking).toHaveBeenCalledWith({ companyId: 'co-1', branchId: 'br-1' }, 'bk-new'),
    );
    expect(apiMock.createBooking).toHaveBeenCalledTimes(1);
    // The create request itself still carries no status.
    expect(apiMock.createBooking.mock.calls[0][1]).not.toHaveProperty('status');
    expect(await screen.findByText(/Booking confirmed for 80 guests/)).toBeTruthy();
  });

  it('keeps the draft and says why when the hall cannot be confirmed', async () => {
    apiMock.confirmBooking.mockRejectedValue(new Error('That hall is already booked for an overlapping time.'));
    render(<BookingsPage />);
    await fillForm();
    apiMock.listBookings.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Create & confirm' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/saved as a draft but could not be confirmed/);
    expect(alert.textContent).toMatch(/already booked/);
    // The list is reloaded, so the kept draft is shown.
    await waitFor(() => expect(apiMock.listBookings).toHaveBeenCalled());
  });

  it('Create draft never confirms', async () => {
    render(<BookingsPage />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText(/Draft booking created for 80 guests/)).toBeTruthy();
    expect(apiMock.confirmBooking).not.toHaveBeenCalled();
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

  it('offers Create & confirm only to someone allowed to confirm', async () => {
    branchPermissions = ['banquet.view', 'banquet.booking.create'];
    render(<BookingsPage />);
    await fillForm();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create & confirm' })).toBeNull();
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

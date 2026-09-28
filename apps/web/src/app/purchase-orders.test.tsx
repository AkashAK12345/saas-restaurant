import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { OrderCard, OrderDetail } from '@/lib/inventory/purchase-orders';

const orders = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  receive: vi.fn(),
  cancel: vi.fn(),
  markSent: vi.fn(),
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  photo: vi.fn(),
  pdf: vi.fn(),
}));
const inventory = vi.hoisted(() => ({
  filters: vi.fn(),
  suppliers: vi.fn(),
  searchItems: vi.fn(),
  supplier: vi.fn(),
  updateSupplier: vi.fn(),
  createSupplier: vi.fn(),
}));
const reportsApi = vi.hoisted(() => ({ saveFile: vi.fn() }));
vi.mock('@/lib/reports/api', () => reportsApi);
vi.mock('@/lib/inventory/purchase-orders', async (real) => ({
  ...(await real<typeof import('@/lib/inventory/purchase-orders')>()),
  purchaseOrdersApi: orders,
}));
vi.mock('@/lib/inventory/api', () => ({ inventoryApi: inventory }));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'po-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/inventory/purchase/po-1',
}));

const { default: PurchasePage } = await import('@/app/(staff)/(app)/inventory/purchase/page');
const { default: OrderPage } = await import('@/app/(staff)/(app)/inventory/purchase/[id]/page');
const { orderMessage, whatsappLink, whatsappNumber } = await import('@/lib/inventory/purchase-orders');

const card = (over: Partial<OrderCard>): OrderCard => ({
  id: 'po-1',
  po_number: 'PO-1',
  status: 'ORDERED',
  vendor: { id: 'v1', name: 'Sri Ganeshr Trd', phone: '9840012345' },
  branch: { id: 'b1', name: 'Pallavaram' },
  created_by: 'sinanlegend287',
  ordered_at: '2026-09-28T05:00:00.000Z',
  received_at: null,
  invoice_number: null,
  whatsapp_sent_at: null,
  items_count: 1,
  received_count: 0,
  chips: [{ name: 'Aquafina Water Bottle 1 Ltr', quantity: 1, unit: 'case' }],
  more_items: 0,
  total_minor: 13_000,
  paid_minor: 0,
  currency: 'INR',
  may_edit: true,
  ...over,
});

const AWAITING = card({});
const RECEIVED = card({
  id: 'po-2',
  status: 'RECEIVED',
  vendor: { id: 'v2', name: 'GAS AGENCY KSA', phone: null },
  branch: { id: 'b2', name: 'Central Samco Kitchen - CSK' },
  received_at: '2026-09-28T06:13:00.000Z',
  invoice_number: 'INV-CEN-2609-0135',
  total_minor: 1_158_299,
  chips: [],
});

const detail = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  id: 'po-1',
  po_number: 'PO-1',
  status: 'ORDERED',
  source: 'MANUAL',
  vendor: { id: 'v1', name: 'Sri Ganeshr Trd', phone: '9840012345', label: null },
  branch: { id: 'b1', name: 'Pallavaram' },
  created_by: 'sinanlegend287',
  ordered_at: '2026-09-28T05:00:00.000Z',
  received_at: null,
  cancelled_at: null,
  whatsapp_sent_at: null,
  notes: null,
  total_minor: 13_000,
  paid_minor: 0,
  currency: 'INR',
  lines: [
    {
      id: 'l1',
      item_id: 'water',
      name: 'Aquafina Water Bottle 1 Ltr',
      quantity: 1,
      unit: 'case',
      stock_unit: 'case',
      conversion_qty: null,
      unit_price_minor: 13_000,
      tax_rate_bps: 0,
      tax_minor: 0,
      line_total_minor: 13_000,
      received: false,
    },
    {
      id: 'l2',
      item_id: 'gas',
      name: 'Lot Gas 33 Kg',
      quantity: 3,
      unit: 'NOS',
      stock_unit: 'NOS',
      conversion_qty: null,
      unit_price_minor: 327_203,
      tax_rate_bps: 1_800,
      tax_minor: 176_690,
      line_total_minor: 1_158_299,
      received: false,
    },
  ],
  receipts: [],
  photos: [],
  may_edit: true,
  may_manage_suppliers: true,
  ...over,
});

describe('Purchase list', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(orders), ...Object.values(inventory)]) fn.mockReset();
    inventory.filters.mockResolvedValue({ branches: [{ id: 'b1', name: 'Pallavaram' }], categories: [], departments: [] });
    inventory.suppliers.mockResolvedValue([{ id: 'v1', name: 'Sri Ganeshr Trd', label: null, phone: null }]);
    orders.list.mockResolvedValue({ counts: { all: 347, sent: 134, cancelled: 6 }, orders: [AWAITING, RECEIVED], meta: { total: 2, limit: 30, offset: 0 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('POW-1. tabs with counts, awaiting and received cards as the reference draws them', async () => {
    render(<PurchasePage />);
    const list = await screen.findByRole('list', { name: 'Purchase orders' });
    expect(screen.getByRole('tab', { name: /^All ?347$/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /^Sent ?134$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelled (6)' }).getAttribute('aria-pressed')).toBe('true');

    const [awaiting, received] = within(list).getAllByRole('listitem');
    expect(within(awaiting).getByText('Awaiting')).toBeTruthy();
    expect(within(awaiting).getByText('1 item · Created by sinanlegend287 · 28 Sep · Pallavaram')).toBeTruthy();
    expect(within(awaiting).getByText('Aquafina Water Bottle 1 Ltr 1 case')).toBeTruthy();
    expect(within(awaiting).getByRole('button', { name: /^Cancel the order/ })).toBeTruthy();

    expect(within(received).getByText('Received')).toBeTruthy();
    expect(within(received).getByText('₹11,582.99')).toBeTruthy();
    expect(within(received).getByText(/Inv INV-CEN-2609-0135 · Central Samco Kitchen - CSK/)).toBeTruthy();
    expect(within(received).getByText('Due ₹11,582.99')).toBeTruthy();
    expect(within(received).queryByRole('button', { name: /^Cancel the order/ })).toBeNull();

    expect(orders.list).toHaveBeenLastCalledWith(
      { companyId: 'co-1' },
      expect.objectContaining({ tab: 'all', include_cancelled: true, sort: 'newest', offset: 0 }),
    );
  });

  it('POW-2. the cancelled toggle, the sort menu, and the Received and Requested tabs', async () => {
    render(<PurchasePage />);
    await screen.findByRole('list', { name: 'Purchase orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelled (6)' }));
    await waitFor(() =>
      expect(orders.list).toHaveBeenLastCalledWith({ companyId: 'co-1' }, expect.objectContaining({ include_cancelled: false })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    const menu = screen.getByRole('menu', { name: 'Sort by' });
    expect(within(menu).getAllByRole('menuitemradio').map((m) => m.textContent)).toEqual([
      'Newest first',
      'Oldest first',
      'Recently received',
      'Supplier (A–Z)',
      'Highest amount',
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Highest amount' }));
    await waitFor(() =>
      expect(orders.list).toHaveBeenLastCalledWith({ companyId: 'co-1' }, expect.objectContaining({ sort: 'amount' })),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Received' }));
    await waitFor(() =>
      expect(orders.list).toHaveBeenLastCalledWith({ companyId: 'co-1' }, expect.objectContaining({ tab: 'received', include_cancelled: false })),
    );
    expect(screen.queryByRole('button', { name: /Cancelled/ })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Requested' }));
    expect(screen.getByText('No items to select')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search items')).toBeTruthy();
  });

  it('POW-3. cancels after asking; send opens the two-step WhatsApp guide', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    orders.cancel.mockResolvedValue(detail({ status: 'CANCELLED' }));
    orders.get.mockResolvedValue(detail());
    render(<PurchasePage />);
    const list = await screen.findByRole('list', { name: 'Purchase orders' });
    const awaiting = within(list).getAllByRole('listitem')[0];

    fireEvent.click(within(awaiting).getByRole('button', { name: /^Send the order/ }));
    expect(await screen.findByRole('dialog', { name: 'Send to Sri Ganeshr Trd' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(within(awaiting).getByRole('button', { name: /^Cancel the order/ }));
    await waitFor(() => expect(orders.cancel).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1'));
    expect(window.confirm).toHaveBeenCalledWith('Cancel the order to Sri Ganeshr Trd?');
  });
});

describe('Receive Order', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(orders), ...Object.values(inventory)]) fn.mockReset();
    inventory.suppliers.mockResolvedValue([
      { id: 'v1', name: 'Sri Ganeshr Trd', label: null, phone: null },
      { id: 'v9', name: 'Fresh Green', label: 'Veg', phone: null },
    ]);
    orders.photo.mockResolvedValue({ blob: new Blob(['x']), filename: 'p.png' });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  const receiveButton = () => screen.getByRole('button', { name: /^Receive \(/ }) as HTMLButtonElement;

  it('ROW-1. opens as the reference: supplier, auto invoice, ticked lines, GST, and no receiving without a photo', async () => {
    orders.get.mockResolvedValue(detail());
    render(<OrderPage />);
    expect(await screen.findByRole('heading', { name: 'Receive Order' })).toBeTruthy();
    expect(screen.getByText('Awaiting · 2 items')).toBeTruthy();
    expect(screen.getByText('Auto-generated on receive')).toBeTruthy();
    expect((screen.getByLabelText('Price of Aquafina Water Bottle 1 Ltr') as HTMLInputElement).value).toBe('130.00');
    expect(screen.getByText('GST 18% · ₹1,766.90')).toBeTruthy();
    expect(screen.getByText('Reference Photos (0/10)')).toBeTruthy();
    // Both ticked: ₹130 + ₹11,582.99.
    expect(screen.getByText('₹11,712.99')).toBeTruthy();
    expect(receiveButton().textContent).toBe('Receive (2)');
    expect(receiveButton().disabled).toBe(true);
    expect(screen.getByText('Add at least one delivery photo to receive')).toBeTruthy();
    expect(screen.getByText('Unpaid')).toBeTruthy();
  });

  it('ROW-2. receives only the ticked lines, with the payment made', async () => {
    orders.get.mockResolvedValue(detail({ photos: [{ id: 'ph1', mime_type: 'image/png', file_name: null, position: 0, received: false }] }));
    orders.receive.mockResolvedValue(
      detail({
        lines: detail().lines.map((l, i) => ({ ...l, received: i === 0 })),
        receipts: [
          { id: 'r1', invoice_number: 'INV-PAL-2609-0001', total_minor: 13_000, paid_minor: 5_000, payment_mode: 'UPI', received_at: '2026-09-28T06:00:00.000Z', items: 1 },
        ],
        photos: [{ id: 'ph1', mime_type: 'image/png', file_name: null, position: 0, received: true }],
      }),
    );
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Receive Lot Gas 33 Kg' }));
    expect(receiveButton().textContent).toBe('Receive (1)');
    fireEvent.change(screen.getByLabelText('Paid Amount'), { target: { value: '200' } });
    expect(screen.getByText('More than this delivery comes to')).toBeTruthy();
    expect(receiveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Paid Amount'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'UPI' } });
    expect(screen.getByText('Part paid')).toBeTruthy();
    expect(screen.getByText('Outstanding ₹80.00')).toBeTruthy();
    fireEvent.click(receiveButton());

    expect(await screen.findByText('Received 1 item under INV-PAL-2609-0001.')).toBeTruthy();
    expect(orders.receive).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1', {
      lines: [
        { id: 'l1', item_id: 'water', quantity: 1, rate_minor: 13_000, receive: true },
        { id: 'l2', item_id: 'gas', quantity: 3, rate_minor: 327_203, receive: false },
      ],
      paid_minor: 5_000,
      payment_mode: 'UPI',
    });
    // The rest waits: the received line is read only, under its receipt.
    expect(screen.getByText(/Inv INV-PAL-2609-0001 · 1 item/)).toBeTruthy();
    expect(screen.getByText('Received', { selector: 'span' })).toBeTruthy();
    expect(screen.getByLabelText('Quantity of Lot Gas 33 Kg')).toBeTruthy();
  });

  it('ROW-3. saves a changed supplier, a removed line and an added item', async () => {
    orders.get.mockResolvedValue(detail());
    orders.update.mockResolvedValue(detail());
    inventory.searchItems.mockResolvedValue([
      { id: 'sugar', name: 'Sugar 50 Kg Bag', unit: 'Kg', purchase_unit: 'Bag', conversion_qty: 50, purchase_price_minor: 200_000, tax_rate_bps: 500, category: null },
    ]);
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change supplier' })).getByRole('option', { name: /Fresh Green/ }));
    expect(screen.getByText('Fresh Green')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Aquafina Water Bottle 1 Ltr' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByPlaceholderText('Search raw materials to add…'), { target: { value: 'sug' } });
    fireEvent.click(await screen.findByRole('button', { name: /Sugar 50 Kg Bag/ }));
    expect((screen.getByLabelText('Price of Sugar 50 Kg Bag') as HTMLInputElement).value).toBe('2000.00');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(orders.update).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1', {
      vendor_id: 'v9',
      lines: [
        { id: 'l2', item_id: 'gas', quantity: 3, rate_minor: 327_203 },
        { item_id: 'sugar', quantity: 1, rate_minor: 200_000 },
      ],
    });
  });

  it('ROW-4. a received order reads as the reference: receipts, lines with GST, photos, grand total', async () => {
    orders.get.mockResolvedValue(
      detail({
        status: 'RECEIVED',
        may_edit: false,
        vendor: { id: 'v2', name: 'GAS AGENCY KSA', phone: null, label: null },
        lines: [{ ...detail().lines[1], received: true }],
        total_minor: 1_158_299,
        receipts: [
          { id: 'r1', invoice_number: 'INV-CEN-2609-0135', total_minor: 1_158_299, paid_minor: 0, payment_mode: null, received_at: '2026-09-28T06:13:00.000Z', items: 1 },
        ],
        photos: [{ id: 'ph1', mime_type: 'image/jpeg', file_name: null, position: 0, received: true }],
      }),
    );
    render(<OrderPage />);
    expect(await screen.findByRole('heading', { name: 'Order' })).toBeTruthy();
    expect(screen.getByText('Received · 1 item')).toBeTruthy();
    expect(screen.getByText('Invoice Number')).toBeTruthy();
    expect(screen.getAllByText(/INV-CEN-2609-0135/)[0].textContent).toBe('INV-CEN-2609-0135');
    expect(screen.getByText(/Inv INV-CEN-2609-0135 · 1 item · 28 Sep/)).toBeTruthy();
    expect(screen.getByText('GST 18% · ₹1,766.90')).toBeTruthy();
    expect(screen.getByText('Reference Photos (1/10)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo 1' })).toBeNull();
    expect(screen.getAllByText('₹11,582.99').length).toBeGreaterThan(0);
  });
});

describe('Send to supplier', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(orders), ...Object.values(inventory), reportsApi.saveFile]) fn.mockReset();
    orders.get.mockResolvedValue(detail());
    inventory.suppliers.mockResolvedValue([]);
    orders.photo.mockResolvedValue({ blob: new Blob(['x']), filename: 'p.png' });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('SND-1. message then PDF, each confirmed; marked sent only once the PDF went', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    orders.pdf.mockResolvedValue({ blob: new Blob(['%PDF-']), filename: 'PO-1.pdf' });
    orders.markSent.mockResolvedValue(detail({ whatsapp_sent_at: '2026-09-28T07:00:00.000Z' }));
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    const sheet = screen.getByRole('dialog', { name: 'Send to Sri Ganeshr Trd' });
    expect(within(sheet).getByText(/^Not marked sent until you confirm the PDF went/)).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Send message' }));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/919840012345\?text=/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, sent' }));
    expect(within(sheet).queryByText('Skip message — send PDF only')).toBeNull();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Send PDF' }));
    await within(sheet).findByText('Did the PDF go?');
    // No share sheet in a test browser: the PDF is saved, to attach.
    expect(reportsApi.saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'PO-1.pdf' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, sent' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(orders.markSent).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Send to/ })).toBeNull());
  });

  it('SND-2. without the PDF confirmed, Done just closes; the message may be skipped', async () => {
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));
    const sheet = screen.getByRole('dialog', { name: 'Send to Sri Ganeshr Trd' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Skip message — send PDF only' }));
    expect(within(sheet).getByText('Skipped — the PDF alone.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: /^Send to/ })).toBeNull();
    expect(orders.markSent).not.toHaveBeenCalled();
  });
});

describe('Edit Supplier', () => {
  const CURRENT = {
    id: 'v1',
    name: 'Sri Ganeshr Trd',
    label: null,
    phone: '9884511100',
    gstin: null,
    address: null,
    bank_account_name: 'Sri Ganeshr',
    bank_account_number: '282073000002662',
    bank_ifsc: 'SIBL0000282',
    bank_name: null,
    bank_branch: null,
    upi_id: null,
    may_edit: true,
  };
  beforeEach(() => {
    for (const fn of [...Object.values(orders), ...Object.values(inventory)]) fn.mockReset();
    orders.get.mockResolvedValue(detail());
    inventory.suppliers.mockResolvedValue([
      { id: 'v1', name: 'Sri Ganeshr Trd', label: null, phone: null },
      { id: 'v9', name: 'Fresh Green', label: 'Veg', phone: null },
    ]);
    inventory.supplier.mockImplementation(async (_c: unknown, id: string) =>
      id === 'v9' ? { ...CURRENT, id: 'v9', name: 'Fresh Green', bank_ifsc: null } : CURRENT,
    );
  });

  it('EDS-1. shows the current supplier and its bank details, as the reference does', async () => {
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Supplier' });
    expect(within(sheet).getByText('Current: Sri Ganeshr Trd')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Switch supplier: none chosen' })).toBeTruthy();
    expect(((await within(sheet).findByLabelText('Phone')) as HTMLInputElement).value).toBe('9884511100');
    expect((within(sheet).getByLabelText('IFSC code') as HTMLInputElement).value).toBe('SIBL0000282');
    for (const label of ['Bank name', 'Bank branch', 'UPI ID', 'GSTIN']) expect(within(sheet).getByLabelText(label)).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('EDS-2. saves edited details and switches the order to the supplier picked', async () => {
    inventory.updateSupplier.mockResolvedValue({});
    orders.update.mockResolvedValue(detail({ vendor: { id: 'v9', name: 'Fresh Green', phone: null, label: 'Veg' } }));
    render(<OrderPage />);
    await screen.findByRole('heading', { name: 'Receive Order' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit Supplier' });
    await within(sheet).findByLabelText('Phone');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Switch supplier: none chosen' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Switch supplier' })).getByText('Fresh Green'));
    await waitFor(() => expect(inventory.supplier).toHaveBeenLastCalledWith({ companyId: 'co-1' }, 'v9'));
    expect(await within(sheet).findByText('Edit new supplier')).toBeTruthy();
    fireEvent.change(await within(sheet).findByLabelText('UPI ID'), { target: { value: 'freshgreen@okaxis' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Supplier' })).toBeNull());
    expect(inventory.updateSupplier).toHaveBeenCalledWith({ companyId: 'co-1' }, 'v9', { upi_id: 'freshgreen@okaxis' });
    expect(orders.update).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1', { vendor_id: 'v9' });
    expect(screen.getByText('Fresh Green')).toBeTruthy();
  });
});

describe('WhatsApp', () => {
  it('dials Indian numbers with the country code, and lists what is still awaited', () => {
    expect(whatsappNumber('98400 12345')).toBe('919840012345');
    expect(whatsappNumber('+91 98400-12345')).toBe('919840012345');
    expect(whatsappNumber('09840012345')).toBe('919840012345');
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappLink(null, 'hi')).toBe('https://wa.me/?text=hi');
    const order = detail({ lines: detail().lines.map((l, i) => ({ ...l, received: i === 0 })) });
    expect(orderMessage(order)).toBe(
      ['*Purchase order PO-1*', 'To: Sri Ganeshr Trd', 'Deliver to: Pallavaram', '', '1. Lot Gas 33 Kg — 3 NOS', '', 'Please confirm. Thank you.'].join('\n'),
    );
  });
});

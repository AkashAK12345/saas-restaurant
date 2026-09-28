import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { PurchasableItem } from '@/lib/inventory/api';

const api = vi.hoisted(() => ({
  purchaseOptions: vi.fn(),
  suppliers: vi.fn(),
  searchItems: vi.fn(),
  recordPurchase: vi.fn(),
  createSupplier: vi.fn(),
}));
vi.mock('@/lib/inventory/api', () => ({ inventoryApi: api }));
const orders = vi.hoisted(() => ({ uploadPhoto: vi.fn(), get: vi.fn(), receive: vi.fn() }));
vi.mock('@/lib/inventory/purchase-orders', async (real) => ({
  ...(await real<typeof import('@/lib/inventory/purchase-orders')>()),
  purchaseOrdersApi: orders,
}));
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));

const { default: ManualPurchasePage } = await import('@/app/(staff)/(app)/inventory/manual-purchase/page');
const { parseQuantity, parseRupees, rupeesInput } = await import('@/lib/inventory/format');

const SUGAR: PurchasableItem = {
  id: 'sugar',
  name: 'Sugar 50 Kg Bag',
  unit: 'Kg',
  purchase_unit: 'Bag',
  conversion_qty: 50,
  purchase_price_minor: 200_000,
  tax_rate_bps: 500,
  category: 'Food & Beverages',
};
const PAN: PurchasableItem = {
  id: 'pan',
  name: 'Dust Pan',
  unit: 'Piece',
  purchase_unit: 'Piece',
  conversion_qty: null,
  purchase_price_minor: null,
  tax_rate_bps: 1_800,
  category: null,
};

async function pick(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByText(option));
}

async function addItem(query: string, name: string) {
  fireEvent.change(screen.getByPlaceholderText('Search raw materials to add…'), { target: { value: query } });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

describe('Manual Purchase screen', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(api), ...Object.values(orders)]) fn.mockReset();
    search.value = '';
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    api.purchaseOptions.mockResolvedValue({
      outlets: [
        { id: 'b1', name: 'Alwarpet' },
        { id: 'b2', name: 'Pallavaram' },
      ],
      may_create_supplier: true,
    });
    api.suppliers.mockResolvedValue([
      { id: 'v1', name: 'Abad Foods', label: 'Seafood', phone: null },
      { id: 'v2', name: 'Safco Oil', label: 'Oil', phone: null },
    ]);
    api.searchItems.mockImplementation(async (_ctx: unknown, q: string) =>
      [SUGAR, PAN].filter((i) => i.name.toLowerCase().includes(q.toLowerCase())),
    );
  });

  it('MPW-1. starts as the reference does: outlet, supplier, create, search, empty list, a disabled ₹0.00 button', async () => {
    render(<ManualPurchasePage />);
    expect(screen.getByRole('heading', { name: 'Manual Purchase' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Outlet: none chosen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supplier: none chosen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create new supplier' })).toBeTruthy();
    expect(screen.getByText('No items yet — search above to add.')).toBeTruthy();
    const record = screen.getByRole('button', { name: 'Record purchase (₹0.00)' }) as HTMLButtonElement;
    expect(screen.getByRole('radio', { name: /Record as received/ })).toBeTruthy();
    expect(record.disabled).toBe(true);
  });

  it('MPW-2. lines as the reference draws them: qty, rate, GST slab, into stock; totals follow every edit', async () => {
    render(<ManualPurchasePage />);
    await screen.findByRole('button', { name: 'Outlet: none chosen' });
    await addItem('sug', 'Sugar 50 Kg Bag');

    const line = screen.getByRole('list', { name: 'Items on this purchase' });
    expect((within(line).getByLabelText('Qty (Bag)') as HTMLInputElement).value).toBe('1');
    expect((within(line).getByLabelText('Rate (₹ / Bag)') as HTMLInputElement).value).toBe('2000');
    expect((within(line).getByLabelText('GST on Sugar 50 Kg Bag') as HTMLSelectElement).value).toBe('500');
    // 1 × ₹2,000 + 5% GST.
    expect(within(line).getByText('₹2,100.00')).toBeTruthy();
    expect(within(line).getByText('Into stock: 50 Kg')).toBeTruthy();

    fireEvent.change(within(line).getByLabelText('Qty (Bag)'), { target: { value: '2' } });
    fireEvent.change(within(line).getByLabelText('GST on Sugar 50 Kg Bag'), { target: { value: '1800' } });
    // 2 × ₹2,000 = ₹4,000 + 18% = ₹4,720.
    expect(within(line).getByText('₹4,720.00')).toBeTruthy();
    expect(within(line).getByText('Into stock: 100 Kg')).toBeTruthy();
    const totals = screen.getByText('Subtotal').closest('dl')!;
    expect(within(totals).getByText('₹4,000.00')).toBeTruthy();
    expect(within(totals).getByText('₹720.00')).toBeTruthy();
    expect(within(totals).getByText('₹4,720.00')).toBeTruthy();

    // Picking an item already on the list adds nothing.
    fireEvent.change(screen.getByPlaceholderText('Search raw materials to add…'), { target: { value: 'sug' } });
    const results = await screen.findByRole('list', { name: 'Matching raw materials' });
    expect(((await within(results).findByRole('button', { name: /Sugar 50 Kg Bag/ })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('MPW-3. recorded as received: needs a photo; saved, photographed and received, with the payment', async () => {
    api.recordPurchase.mockResolvedValue({
      id: 'po-1',
      po_number: 'MP-260928-1',
      status: 'ORDERED',
      invoice_number: null,
      total_minor: 420_000,
      currency: 'INR',
      branch: 'Pallavaram',
      vendor: 'Abad Foods',
      items: 1,
    });
    orders.uploadPhoto.mockResolvedValue({ id: 'ph1', mime_type: 'image/png', file_name: 'bill.png', position: 0, received: false });
    orders.get.mockResolvedValue({
      id: 'po-1',
      lines: [{ id: 'l1', item_id: 'sugar', quantity: 2, unit_price_minor: 200_000, received: false }],
    });
    orders.receive.mockResolvedValue({ receipts: [{ invoice_number: 'INV-PAL-2609-0001' }] });

    render(<ManualPurchasePage />);
    await screen.findByRole('button', { name: 'Outlet: none chosen' });
    expect(screen.getByRole('radio', { name: /Record as received/ })).toHaveProperty('checked', true);
    expect(screen.getByText('Invoice number is generated automatically on receive')).toBeTruthy();
    expect(screen.getByText('No photos attached')).toBeTruthy();
    expect(screen.getByText('Add a delivery photo to record the stock')).toBeTruthy();

    await addItem('sug', 'Sugar 50 Kg Bag');
    fireEvent.change(screen.getByLabelText('Qty (Bag)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('GST on Sugar 50 Kg Bag'), { target: { value: '0' } });
    await pick('Outlet', 'Pallavaram');
    await pick('Supplier', 'Abad Foods');
    const record = () => screen.getByRole('button', { name: /^Record purchase/ }) as HTMLButtonElement;
    // No photo yet.
    expect(record().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Delivery photos'), {
      target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] },
    });
    expect(screen.getByText('Reference Photos (1/10)')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Paid now (₹, optional)'), { target: { value: '5000' } });
    expect(record().disabled).toBe(true);
    expect(screen.getByText('Paid now is more than the total')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Paid now (₹, optional)'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'UPI' } });
    expect(record().textContent).toBe('Record purchase (₹4,000.00)');
    fireEvent.click(record());

    await screen.findByText(/Recorded MP-260928-1: ₹4,200.00 from Abad Foods at Pallavaram · Invoice INV-PAL-2609-0001/);
    expect(api.recordPurchase).toHaveBeenCalledWith(
      { companyId: 'co-1' },
      {
        branch_id: 'b2',
        vendor_id: 'v1',
        as_order: true,
        items: [{ item_id: 'sugar', quantity: 2, rate_minor: 200_000, tax_rate_bps: 0 }],
      },
    );
    expect(orders.uploadPhoto).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1', expect.objectContaining({ mime_type: 'image/png', file_name: 'bill.png' }));
    expect(orders.receive).toHaveBeenCalledWith({ companyId: 'co-1' }, 'po-1', {
      lines: [{ id: 'l1', item_id: 'sugar', quantity: 2, rate_minor: 200_000, receive: true }],
      paid_minor: 100_000,
      payment_mode: 'UPI',
    });
    expect(screen.getByText('No items yet — search above to add.')).toBeTruthy();
    expect(screen.getByText('No photos attached')).toBeTruthy();
  });

  it('MPW-8. saved as an order (the Purchase tab’s Add purchase): no photos or payment, nothing received', async () => {
    search.value = 'as=order';
    api.recordPurchase.mockResolvedValue({
      id: 'po-2',
      po_number: 'MP-260928-2',
      status: 'ORDERED',
      invoice_number: null,
      total_minor: 210_000,
      currency: 'INR',
      branch: 'Pallavaram',
      vendor: 'Abad Foods',
      items: 1,
    });
    render(<ManualPurchasePage />);
    await screen.findByRole('button', { name: 'Outlet: none chosen' });
    expect(screen.getByRole('radio', { name: /Save as order/ })).toHaveProperty('checked', true);
    expect(screen.queryByText('Delivery photos (required)')).toBeNull();
    expect(screen.queryByPlaceholderText('Paid now (₹, optional)')).toBeNull();
    await addItem('sug', 'Sugar 50 Kg Bag');
    await pick('Outlet', 'Pallavaram');
    await pick('Supplier', 'Abad Foods');
    fireEvent.click(screen.getByRole('button', { name: 'Save order (₹2,100.00)' }));
    await screen.findByText(/Saved order MP-260928-2: ₹2,100.00 to Abad Foods for Pallavaram/);
    expect(api.recordPurchase.mock.calls[0][1]).toMatchObject({ as_order: true });
    expect(orders.receive).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/inventory/purchase/po-2');
  });

  it('MPW-9. saved but not received: says so, and where to finish', async () => {
    api.recordPurchase.mockResolvedValue({
      id: 'po-3',
      po_number: 'MP-260928-3',
      status: 'ORDERED',
      invoice_number: null,
      total_minor: 210_000,
      currency: 'INR',
      branch: 'Pallavaram',
      vendor: 'Abad Foods',
      items: 1,
    });
    orders.uploadPhoto.mockRejectedValue(new Error('Photo exceeds the 5MB limit'));
    render(<ManualPurchasePage />);
    await screen.findByRole('button', { name: 'Outlet: none chosen' });
    await addItem('sug', 'Sugar 50 Kg Bag');
    await pick('Outlet', 'Pallavaram');
    await pick('Supplier', 'Abad Foods');
    fireEvent.change(screen.getByLabelText('Delivery photos'), {
      target: { files: [new File(['x'], 'big.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Record purchase/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/MP-260928-3 is saved as an order but was not received: Photo exceeds the 5MB limit/);
    expect(within(alert).getByRole('link', { name: 'Open the order' }).getAttribute('href')).toBe('/inventory/purchase/po-3');
  });

  it('MPW-4. finds a supplier by what it is known for', async () => {
    render(<ManualPurchasePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Supplier: none chosen' }));
    const panel = screen.getByRole('dialog', { name: 'Supplier' });
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'seafood' } });
    expect(within(panel).getByText('Abad Foods')).toBeTruthy();
    expect(within(panel).queryByText('Safco Oil')).toBeNull();
  });

  it('MPW-5. creates a supplier: save waits for name and number, then the new one is chosen', async () => {
    api.createSupplier.mockResolvedValue({ id: 'v9', name: 'Fresh Farms', label: null, phone: '9840012345' });
    render(<ManualPurchasePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create new supplier' }));
    const sheet = screen.getByRole('dialog', { name: 'Create supplier' });
    const save = within(sheet).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(sheet).getByPlaceholderText('Name'), { target: { value: 'Fresh Farms' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(sheet).getByPlaceholderText('Contact number'), { target: { value: '9840012345' } });
    expect(save.disabled).toBe(false);

    fireEvent.click(within(sheet).getByRole('button', { name: /Bank details/ }));
    fireEvent.change(within(sheet).getByPlaceholderText('IFSC'), { target: { value: 'sbin0001234' } });
    fireEvent.click(save);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create supplier' })).toBeNull());
    expect(api.createSupplier.mock.calls[0][1]).toEqual({
      name: 'Fresh Farms',
      phone: '9840012345',
      gstin: undefined,
      address: undefined,
      bank_account_name: undefined,
      bank_account_number: undefined,
      bank_ifsc: 'sbin0001234',
      bank_name: undefined,
    });
    expect(screen.getByRole('button', { name: 'Supplier: Fresh Farms' })).toBeTruthy();
  });

  it('MPW-6. shows the server’s refusal on the form, and keeps what was typed', async () => {
    api.createSupplier.mockRejectedValue(new Error('A supplier named "Fresh Farms" already exists'));
    render(<ManualPurchasePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create new supplier' }));
    const sheet = screen.getByRole('dialog', { name: 'Create supplier' });
    fireEvent.change(within(sheet).getByPlaceholderText('Name'), { target: { value: 'Fresh Farms' } });
    fireEvent.change(within(sheet).getByPlaceholderText('Contact number'), { target: { value: '9840012345' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect((await within(sheet).findByRole('alert')).textContent).toMatch('already exists');
    expect((within(sheet).getByPlaceholderText('Name') as HTMLInputElement).value).toBe('Fresh Farms');
  });

  it('MPW-7. without the right to add suppliers there is no link to', async () => {
    api.purchaseOptions.mockResolvedValue({ outlets: [{ id: 'b1', name: 'Alwarpet' }], may_create_supplier: false });
    render(<ManualPurchasePage />);
    // One outlet is chosen for you.
    expect(await screen.findByRole('button', { name: 'Outlet: Alwarpet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create new supplier' })).toBeNull();
  });
});

describe('purchase entry parsing', () => {
  it('reads rupees to paise, and quantities to three decimals', () => {
    expect(parseRupees('2,000')).toBe(200_000);
    expect(parseRupees('33.5')).toBe(3_350);
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('')).toBeNull();
    expect(parseQuantity('12.5')).toBe(12.5);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1.2345')).toBeNull();
    expect(rupeesInput(3_350)).toBe('33.5');
    expect(rupeesInput(null)).toBe('');
  });
});

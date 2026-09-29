import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { LedgerSupplier, SupplierLedgerDetail } from '@/lib/inventory/supplier-ledger';

const ledgerApi = vi.hoisted(() => ({
  ledger: vi.fn(),
  supplier: vi.fn(),
  recordPayment: vi.fn(),
  payAll: vi.fn(),
  ledgerPdf: vi.fn(),
  statementPdf: vi.fn(),
  invoicePdf: vi.fn(),
}));
vi.mock('@/lib/inventory/supplier-ledger', async (real) => ({
  ...(await real<typeof import('@/lib/inventory/supplier-ledger')>()),
  supplierLedgerApi: ledgerApi,
}));
vi.mock('@/lib/inventory/api', () => ({
  inventoryApi: { filters: vi.fn().mockResolvedValue({ branches: [{ id: 'b1', name: 'Central Samco Kitchen - CSK' }], categories: [], departments: [] }) },
}));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));
vi.mock('@/lib/reports/format', async (real) => ({
  ...(await real<typeof import('@/lib/reports/format')>()),
  branchToday: () => '2026-09-29',
}));
const files = vi.hoisted(() => ({ saveFile: vi.fn() }));
vi.mock('@/lib/reports/api', () => files);

const { default: SuppliersPage } = await import('@/app/(staff)/(app)/inventory/suppliers/page');
const { thisCycle, lastCycle } = await import('@/lib/inventory/supplier-ledger');
const { statementMessage } = await import('@/components/inventory/supplier-ledger-card');

const SAAHIL: LedgerSupplier = {
  vendor_id: 'v1',
  name: 'MOHAMMED SAAHIL MUTTON',
  label: null,
  phone: '9840012345',
  bank: { account_name: 'ZAILABUDDIN H', account_number: '923020024377379', ifsc: 'UTIB0001618', bank_name: null, upi_id: null },
  opening_minor: 9_580_510,
  purchases_minor: 69_276_670,
  paid_minor: 0,
  closing_minor: 78_857_180,
};
const PARVATHI: LedgerSupplier = {
  ...SAAHIL,
  vendor_id: 'v2',
  name: 'Parvathi Trading',
  phone: null,
  bank: { account_name: null, account_number: null, ifsc: null, bank_name: null, upi_id: null },
  opening_minor: 0,
  purchases_minor: 39_885_000,
  closing_minor: 39_885_000,
};
const DETAIL: SupplierLedgerDetail = {
  vendor: { id: 'v1', name: SAAHIL.name, phone: SAAHIL.phone },
  from: '2026-09-16',
  to: '2026-09-30',
  branch: 'All branches',
  opening_minor: SAAHIL.opening_minor,
  purchases_minor: SAAHIL.purchases_minor,
  paid_minor: 0,
  closing_minor: SAAHIL.closing_minor,
  invoices: [
    {
      receipt_id: 'r1',
      order_id: 'o1',
      po_number: 'PO-1',
      invoice_number: 'INV-CEN-2609-0161',
      date: '2026-09-29',
      branch: 'Central Samco Kitchen - CSK',
      total_minor: 3_462_350,
      paid_minor: 0,
      due_minor: 3_462_350,
      earlier: false,
      may_pay: true,
    },
  ],
  payments: [],
  may_pay_all: true,
};

beforeEach(() => {
  for (const fn of Object.values(ledgerApi)) fn.mockReset();
  files.saveFile.mockReset();
  ledgerApi.ledger.mockResolvedValue({
    from: '2026-09-16',
    to: '2026-09-30',
    currency: 'INR',
    summary: { purchases_minor: 219_117_010, paid_minor: 14_998_185, pending_minor: 230_516_674 },
    suppliers: [SAAHIL, PARVATHI],
  });
  ledgerApi.supplier.mockResolvedValue(DETAIL);
});

describe('Suppliers ledger', () => {
  it('SLW-1. this cycle by default: the totals and a card per supplier, as the reference draws them', async () => {
    render(<SuppliersPage />);
    expect(screen.getByRole('tab', { name: 'Suppliers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'This cycle' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('16 Sep – 30 Sep 2026')).toBeTruthy();
    expect(await within(await screen.findByRole('region', { name: 'Purchases' })).findByText('₹21,91,170.10')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Paid' })).getByText('₹1,49,981.85')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Pending' })).getByText('₹23,05,166.74')).toBeTruthy();
    const cards = within(await screen.findByRole('list', { name: 'Suppliers' })).getAllByRole('listitem');
    expect(cards[0].textContent).toBe(
      'MOHAMMED SAAHIL MUTTONDue ₹7,88,571.80Opening₹95,805.10Purchases₹6,92,766.70Paid₹0.00Closing₹7,88,571.80',
    );
    expect(ledgerApi.ledger).toHaveBeenLastCalledWith({ companyId: 'co-1' }, { from: '2026-09-16', to: '2026-09-30' });
  });

  it('SLW-2. last cycle, a branch and a search narrow it', async () => {
    render(<SuppliersPage />);
    await screen.findByRole('list', { name: 'Suppliers' });
    fireEvent.click(screen.getByRole('button', { name: 'Last cycle' }));
    expect(screen.getByText('1 Sep – 15 Sep 2026')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search supplier name or phone'), { target: { value: 'saahil' } });
    await waitFor(() =>
      expect(ledgerApi.ledger).toHaveBeenLastCalledWith({ companyId: 'co-1' }, { from: '2026-09-01', to: '2026-09-15', q: 'saahil' }),
    );
  });

  it('SLW-3. opened: bank details, invoices with what is due, record a payment, pay all', async () => {
    ledgerApi.recordPayment.mockResolvedValue({ paid_minor: 1_000_000 });
    ledgerApi.payAll.mockResolvedValue({ invoices: 3, paid_minor: 78_857_180 });
    render(<SuppliersPage />);
    const list = await screen.findByRole('list', { name: 'Suppliers' });
    fireEvent.click(within(list).getByRole('button', { name: /MOHAMMED SAAHIL MUTTON/ }));
    const invoices = await screen.findByRole('list', { name: 'Invoices from MOHAMMED SAAHIL MUTTON' });
    expect(screen.getByText('ZAILABUDDIN H')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy IFSC' })).toBeTruthy();
    const invoice = within(invoices).getAllByRole('listitem')[0];
    expect(invoice.textContent).toContain('29 Sep · INV-CEN-2609-0161');
    expect(invoice.textContent).toContain('₹34,623.50 · paid ₹0.00');
    expect(within(invoice).getByText('Due ₹34,623.50')).toBeTruthy();

    fireEvent.click(within(invoice).getByRole('button', { name: 'Record payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Record payment · INV-CEN-2609-0161' });
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: '40000' } });
    expect((within(dialog).getByRole('button', { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: '10000' } });
    fireEvent.change(within(dialog).getByLabelText('Paid by'), { target: { value: 'UPI' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay ₹10,000.00' }));
    await waitFor(() =>
      expect(ledgerApi.recordPayment).toHaveBeenCalledWith({ companyId: 'co-1' }, 'r1', { amount_minor: 1_000_000, payment_mode: 'UPI' }),
    );
    expect(await screen.findByText('Recorded ₹10,000.00 paid on INV-CEN-2609-0161.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Pay all ₹7,88,571.80' }));
    const all = screen.getByRole('dialog', { name: 'Pay all to MOHAMMED SAAHIL MUTTON' });
    fireEvent.click(within(all).getByRole('button', { name: 'Pay ₹7,88,571.80' }));
    await waitFor(() => expect(ledgerApi.payAll).toHaveBeenCalledWith({ companyId: 'co-1' }, 'v1', { branch_id: undefined, payment_mode: 'CASH' }));
  });

  it('SLW-4. send: the summary as a message, then the statement PDF; nothing recorded', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    ledgerApi.statementPdf.mockResolvedValue({ blob: new Blob(['%PDF-']), filename: 'statement.pdf' });
    render(<SuppliersPage />);
    const list = await screen.findByRole('list', { name: 'Suppliers' });
    fireEvent.click(within(list).getByRole('button', { name: /MOHAMMED SAAHIL MUTTON/ }));
    await screen.findByRole('list', { name: 'Invoices from MOHAMMED SAAHIL MUTTON' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const sheet = screen.getByRole('dialog', { name: 'Send to MOHAMMED SAAHIL MUTTON' });
    expect(within(sheet).getByText('Nothing about this send is recorded on the orders.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send message' }));
    expect(decodeURIComponent(open.mock.calls[0][0] as string)).toContain('*Closing (due): ₹7,88,571.80*');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send PDF' }));
    await waitFor(() => expect(files.saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'statement.pdf' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: /^Send to/ })).toBeNull();
    open.mockRestore();
  });

  it('SLW-5. the download saves the ledger as CSV', async () => {
    render(<SuppliersPage />);
    await screen.findByRole('list', { name: 'Suppliers' });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(files.saveFile).toHaveBeenCalled());
    const saved = files.saveFile.mock.calls[0][0];
    expect(saved.filename).toBe('supplier-ledger-2026-09-16-to-2026-09-30.csv');
    expect((await saved.blob.text()).split('\n').slice(0, 2)).toEqual([
      'Supplier,Phone,Opening,Purchases,Paid,Closing',
      'MOHAMMED SAAHIL MUTTON,9840012345,95805.10,692766.70,0.00,788571.80',
    ]);
  });
});

describe('cycles and the statement message', () => {
  it('halves of the month', () => {
    expect(thisCycle('2026-09-29')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(thisCycle('2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(lastCycle('2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(lastCycle('2026-03-10')).toEqual({ from: '2026-02-16', to: '2026-02-28' });
    expect(lastCycle('2026-01-05')).toEqual({ from: '2025-12-16', to: '2025-12-31' });
  });

  it('lists what is due', () => {
    expect(statementMessage(SAAHIL, DETAIL, '16 Sep – 30 Sep 2026')).toBe(
      [
        '*Statement: 16 Sep – 30 Sep 2026*',
        'To: MOHAMMED SAAHIL MUTTON',
        '',
        'Opening: ₹95,805.10',
        'Purchases: ₹6,92,766.70',
        'Paid: ₹0.00',
        '*Closing (due): ₹7,88,571.80*',
        '',
        'Due invoices:',
        '• 29 Sep · INV-CEN-2609-0161 — ₹34,623.50',
      ].join('\n'),
    );
  });
});

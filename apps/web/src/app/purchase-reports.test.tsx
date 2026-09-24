import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReportMetric, ReportResponse } from '@/lib/reports/types';

const run = vi.hoisted(() => vi.fn());
const exportReport = vi.hoisted(() => vi.fn());
const saveFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reports/api', () => ({
  reportsApi: { run: (...a: unknown[]) => run(...a), export: (...a: unknown[]) => exportReport(...a) },
  saveFile: (...a: unknown[]) => saveFile(...a),
}));

let branchPermissions: string[] = ['reports.view', 'purchase.reports.view', 'reports.export'];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    selectedBranch: { id: 'br-1', name: 'Alwarpet', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    branchPermissions,
  }),
}));

const { default: PurchaseReportsPage } = await import('@/app/(staff)/(app)/reports/purchase/page');
const { matchesSearch, pillRangeLabel } = await import('@/lib/reports/purchase-ui');

const METRICS = (amount = 0, sent = '0/0'): ReportMetric[] => [
  { key: 'total_amount', label: 'Total Amount', value: amount, type: 'money', currency: 'INR' },
  { key: 'total_items', label: 'Total Items', value: 0, type: 'number' },
  { key: 'vendors', label: 'Vendors', value: 0, type: 'number' },
  { key: 'whatsapp_sent', label: 'WhatsApp Sent', value: sent, type: 'string' },
  { key: 'orders', label: 'Orders', value: 0, type: 'number' },
];

function response(key: string, rows: ReportResponse['rows'], metrics = METRICS()): ReportResponse {
  const columns: ReportResponse['columns'] =
    key === 'purchase.by_item'
      ? [
          { key: 'item', label: 'Item', type: 'string' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'amount_minor', label: 'Amount', type: 'money' },
          { key: 'vendors', label: 'Vendors', type: 'string' },
        ]
      : [
          { key: 'vendor', label: 'Vendor', type: 'string' },
          { key: 'orders', label: 'Orders', type: 'number' },
          { key: 'amount_minor', label: 'Amount', type: 'money' },
          { key: 'whatsapp_sent', label: 'WhatsApp Sent', type: 'string' },
        ];
  return {
    key,
    name: key,
    description: '',
    domain: 'purchase',
    kind: 'summary',
    generated_at: '2026-09-24T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
    filters: { branch_id: 'br-1', from: '2026-09-17', to: '2026-09-24', options: {} },
    columns,
    option_specs: [],
    exportable: true,
    metrics,
    rows,
    meta: { total: rows.length, limit: 50, offset: 0 },
  };
}

describe('Purchase Reports screen', () => {
  beforeEach(() => {
    run.mockReset();
    exportReport.mockReset();
    saveFile.mockReset();
    branchPermissions = ['reports.view', 'purchase.reports.view', 'reports.export'];
    run.mockImplementation(async (_ctx: unknown, key: string) => response(key, []));
  });

  it('PU-1. an empty week as the reference shows it: four cards, both views, "No purchases found"', async () => {
    const { container } = render(<PurchaseReportsPage />);
    expect(await screen.findByText('No purchases found for this period')).toBeTruthy();
    expect(
      [...container.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.parentElement?.querySelector('dd')?.textContent]),
    ).toEqual([
      ['Total Amount', '₹0.00'],
      ['Total Items', '0'],
      ['Vendors', '0'],
      ['WhatsApp Sent', '0/0'],
    ]);
    expect(screen.getByRole('button', { name: 'By Vendor' }).getAttribute('aria-pressed')).toBe('true');
    // The last week, both ends included: eight days.
    const query = run.mock.calls[0][2];
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
    expect(days).toBe(8);
    expect(run.mock.calls[0][1]).toBe('purchase.by_vendor');
  });

  it('PU-2. By Item runs its own report; search narrows the loaded rows', async () => {
    run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'purchase.by_item'
        ? response(key, [
            { item: 'Onion', quantity: 30, amount_minor: 90_000, currency: 'INR', vendors: 'Fresh Farms, Metro' },
            { item: 'Basmati Rice', quantity: 25, amount_minor: 150_000, currency: 'INR', vendors: 'Metro' },
          ])
        : response(key, []),
    );
    render(<PurchaseReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'By Item' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Onion')).toBeTruthy();
    expect(run.mock.calls.at(-1)?.[1]).toBe('purchase.by_item');

    fireEvent.change(screen.getByPlaceholderText('Search vendors or items'), { target: { value: 'rice' } });
    expect(within(table).queryByText('Onion')).toBeNull();
    expect(within(table).getByText('Basmati Rice')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search vendors or items'), { target: { value: 'paneer' } });
    expect(screen.getByText('Nothing matches “paneer”')).toBeTruthy();
  });

  it('PU-3. the date pill opens "Select Date Range" and re-runs over the range chosen', async () => {
    render(<PurchaseReportsPage />);
    await screen.findByText('No purchases found for this period');
    fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
    const dialog = screen.getByRole('dialog', { name: 'Select Date Range' });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-09-10' } });
    run.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(run.mock.calls.at(-1)?.[2]).toMatchObject({ from: '2026-09-01', to: '2026-09-10' }));
    expect(screen.getByText('1 Sep 26 – 10 Sep 26')).toBeTruthy();
  });

  it('PU-4. Export downloads the view on screen; without reports.export there is no button', async () => {
    exportReport.mockResolvedValue({ filename: 'purchases.xlsx', blob: new Blob() });
    const { unmount } = render(<PurchaseReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(exportReport.mock.calls[0][1]).toBe('purchase.by_vendor');
    expect(exportReport.mock.calls[0][2]).toBe('xlsx');
    unmount();

    branchPermissions = ['reports.view', 'purchase.reports.view'];
    render(<PurchaseReportsPage />);
    await screen.findByText('No purchases found for this period');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('PU-5. a refused report is shown, not silently empty', async () => {
    run.mockRejectedValue(new Error('You do not have permission to view purchase reports'));
    render(<PurchaseReportsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('permission');
  });
});

describe('Purchase Reports helpers', () => {
  it('labels the date pill', () => {
    expect(pillRangeLabel('2026-09-17', '2026-09-24')).toBe('17 Sep 26 – 24 Sep 26');
    expect(pillRangeLabel('2026-09-24', '2026-09-24')).toBe('24 Sep 26');
  });

  it('searches vendor and item names, ignoring case', () => {
    expect(matchesSearch({ vendor: 'Fresh Farms' }, 'fresh')).toBe(true);
    expect(matchesSearch({ item: 'Onion', vendors: 'Metro Wholesale' }, 'metro')).toBe(true);
    expect(matchesSearch({ item: 'Onion' }, 'rice')).toBe(false);
    expect(matchesSearch({ item: 'Onion' }, '  ')).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const reports = vi.hoisted(() => ({
  options: vi.fn(),
  monthlyAvg: vi.fn(),
  comparative: vi.fn(),
  consolidated: vi.fn(),
  closingStock: vi.fn(),
  transfers: vi.fn(),
}));
vi.mock('@/lib/inventory/reports', async (real) => ({
  ...(await real<typeof import('@/lib/inventory/reports')>()),
  inventoryReportsApi: reports,
}));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));
const route = vi.hoisted(() => ({ key: 'monthly-avg' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ key: route.key }) }));
const files = vi.hoisted(() => ({ saveFile: vi.fn() }));
vi.mock('@/lib/reports/api', () => files);
// A fixed "today": 29 Sep 2026.
vi.mock('@/lib/reports/format', async (real) => ({
  ...(await real<typeof import('@/lib/reports/format')>()),
  branchToday: () => '2026-09-29',
}));

const { default: ReportsList } = await import('@/app/(staff)/(app)/inventory/reports/page');
const { default: ReportPage } = await import('@/app/(staff)/(app)/inventory/reports/[key]/page');
const { lastDays, monthOf, rangeDash, rangeLabel } = await import('@/lib/inventory/reports');

const OPTIONS = {
  branches: [
    { id: 'b1', name: 'Alwarpet' },
    { id: 'b2', name: 'Central Samco Kitchen - CSK' },
  ],
  items: [
    { id: 'i1', name: 'Cardamom', unit: 'Kg' },
    { id: 'i2', name: 'Mutton Fat', unit: 'Kg' },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(reports)) fn.mockReset();
  reports.options.mockResolvedValue(OPTIONS);
});

describe('Purchase Reports list', () => {
  it('IRW-1. lists the five reports as the reference does, each opening its own page', () => {
    render(<ReportsList />);
    expect(screen.getByRole('heading', { name: 'Purchase Reports' })).toBeTruthy();
    const links = within(screen.getByRole('list', { name: 'Purchase reports' })).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Monthly Avg PurchaseAvg qty + price + order list per item', '/inventory/reports/monthly-avg'],
      ['Comparative Purchase AnalysisPeriod A vs Period B + per-supplier deltas', '/inventory/reports/comparative'],
      ['Head Outlet ConsolidatedItems / Suppliers / Branches across all branches', '/inventory/reports/consolidated'],
      ['Closing Stock Valuationqty × last purchase price', '/inventory/reports/closing-stock'],
      ['Stock TransfersOutlet → outlet movements from the stock ledger', '/inventory/reports/transfers'],
    ]);
  });
});

describe('Monthly Avg Purchase', () => {
  it('IRW-2. this month by default: the summary and the order history as the reference draws them', async () => {
    route.key = 'monthly-avg';
    reports.monthlyAvg.mockResolvedValue({
      summary: { orders: 364, avg_qty: 36.792, avg_price_minor: 16_851, total_qty: 13_392.26, total_spend_minor: 225_674_760, currency: 'INR' },
      rows: [
        { id: 'l1', date: '2026-09-29', supplier: 'MOHAMMED SAAHIL MUTTON', branch: 'Central Samco Kitchen - CSK', item: 'Mutton Fat', quantity: 1.15, unit: 'Kg', price_minor: 25_000, total_minor: 28_750 },
        { id: 'l2', date: '2026-09-29', supplier: 'ELAGRO SPICES', branch: 'Central Samco Kitchen - CSK', item: 'Cardamom', quantity: 8, unit: 'Kg', price_minor: 285_000, total_minor: 2_280_000 },
      ],
      meta: { total: 364, limit: 100, offset: 0 },
    });
    render(<ReportPage />);
    expect(await screen.findByRole('heading', { name: 'Monthly Avg Purchase' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Date: 1 Sep → 30 Sep' })).toBeTruthy();
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '364',
      '36.792',
      '₹168.51',
      '13,392.26',
      '₹22,56,747.60',
    ]);
    const table = screen.getByRole('table', { name: 'Order history' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date',
      'Supplier',
      'Branch',
      'Item',
      'Qty',
      'Price',
      'Total',
    ]);
    expect(within(table).getAllByRole('row')[2].textContent).toBe(
      '29 SepELAGRO SPICESCentral Samco Kitchen - CSKCardamom8 Kg₹2,850.00₹22,800.00',
    );
    expect(reports.monthlyAvg).toHaveBeenLastCalledWith({ companyId: 'co-1' }, { from: '2026-09-01', to: '2026-09-30', limit: 100 });
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
  });

  it('IRW-3. an item and a branch narrow it', async () => {
    route.key = 'monthly-avg';
    reports.monthlyAvg.mockResolvedValue({
      summary: { orders: 0, avg_qty: 0, avg_price_minor: 0, total_qty: 0, total_spend_minor: 0, currency: 'INR' },
      rows: [],
      meta: { total: 0, limit: 100, offset: 0 },
    });
    render(<ReportPage />);
    expect(await screen.findByText('Nothing was received in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Item: All items' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Item' })).getByText('Cardamom'));
    fireEvent.click(screen.getByRole('button', { name: 'Branch: All branches' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Branch' })).getByText('Alwarpet'));
    await waitFor(() =>
      expect(reports.monthlyAvg).toHaveBeenLastCalledWith(
        { companyId: 'co-1' },
        { item_id: 'i1', branch_id: 'b1', from: '2026-09-01', to: '2026-09-30', limit: 100 },
      ),
    );
  });
});

describe('The other reports', () => {
  it('IRW-4. Comparative: this month (A) against last (B), the change over B, supplier cards', async () => {
    route.key = 'comparative';
    reports.comparative.mockResolvedValue({
      a: { from: '2026-09-01', to: '2026-09-30', orders: 167, spend_minor: 225_674_760 },
      b: { from: '2026-08-01', to: '2026-08-31', orders: 30, spend_minor: 22_032_687 },
      delta_minor: 203_642_073,
      delta_pct: 924.3,
      currency: 'INR',
      suppliers: [
        { vendor_id: 'v1', name: 'MOHAMMED SAAHIL MUTTON', a_spend_minor: 74_313_270, b_spend_minor: 4_543_910, delta_minor: 69_769_360, delta_pct: 1535.4 },
        { vendor_id: 'v2', name: 'Parvathi Trading', a_spend_minor: 39_885_000, b_spend_minor: 0, delta_minor: 39_885_000, delta_pct: null },
        { vendor_id: 'v3', name: 'Fresh Green', a_spend_minor: 10_000, b_spend_minor: 20_000, delta_minor: -10_000, delta_pct: -50 },
      ],
    });
    render(<ReportPage />);
    expect(await screen.findByRole('heading', { name: 'Comparative Purchase' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Period A: 1 Sep → 30 Sep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Period B: 1 Aug → 31 Aug' }).getAttribute('data-tone')).toBe('blue');
    expect(reports.comparative).toHaveBeenLastCalledWith(
      { companyId: 'co-1' },
      { a_from: '2026-09-01', a_to: '2026-09-30', b_from: '2026-08-01', b_to: '2026-08-31' },
    );
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getAllByRole('term').map((t) => t.textContent)).toEqual(['Period A spend', 'Period B spend', 'Δ', 'Orders']);
    expect(within(summary).getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '₹22,56,747.60',
      '₹2,20,326.87',
      '+924.3%',
      '167 vs 30',
    ]);
    const cards = within(screen.getByRole('list', { name: 'Per supplier' })).getAllByRole('listitem');
    expect(cards.map((c) => c.textContent)).toEqual([
      'MOHAMMED SAAHIL MUTTONA ₹7,43,132.70B ₹45,439.10+1535%',
      'Parvathi TradingA ₹3,98,850.00B ₹0.00—',
      'Fresh GreenA ₹100.00B ₹200.00−50%',
    ]);
  });

  it('IRW-5. Consolidated: tabs and columns as the reference draws them, and a CSV download', async () => {
    route.key = 'consolidated';
    const row = { unit: null, orders: 0, items: 0, quantity: null, last_price_minor: null, last_buy: null, outstanding_minor: null };
    reports.consolidated.mockImplementation(async (_c: unknown, q: { group: string }) => ({
      group: q.group,
      branches: 6,
      summary: { rows: 1, orders: 4, spend_minor: 90_000, currency: 'INR' },
      rows: {
        items: [
          { ...row, key: 'i1', name: 'Mutton Biriyani Cut', unit: 'Kg', quantity: 838.29, last_price_minor: 83_000, spend_minor: 69_578_070 },
        ],
        suppliers: [{ ...row, key: 'v1', name: 'MOHAMMED SAAHIL MUTTON', items: 4, spend_minor: 74_313_270, last_buy: '2026-09-29' }],
        branches: [
          { ...row, key: 'b1', name: 'Central Samco Kitchen - CSK', items: 41, spend_minor: 210_753_076, outstanding_minor: 210_676_576 },
        ],
      }[q.group],
    }));
    render(<ReportPage />);
    expect(await screen.findByRole('heading', { name: 'Consolidated' })).toBeTruthy();
    expect(screen.getByText('1 Sep → 30 Sep 2026')).toBeTruthy();
    const items = await screen.findByRole('table', { name: 'By item' });
    expect(within(items).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Item', 'Total Qty', 'Last Price', 'Total Spend']);
    expect(within(items).getAllByRole('row')[1].textContent).toBe('Mutton Biriyani Cut838.29 Kg₹830.00₹6,95,780.70');

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    const saved = files.saveFile.mock.calls[0][0];
    expect(saved.filename).toBe('consolidated-items-2026-09-01-to-2026-09-30.csv');
    expect(await saved.blob.text()).toBe('Item,Total Qty,Last Price,Total Spend\nMutton Biriyani Cut,838.29 Kg,830.00,695780.70\n');

    fireEvent.click(screen.getByRole('tab', { name: 'Suppliers' }));
    const suppliers = await screen.findByRole('table', { name: 'By supplier' });
    expect(within(suppliers).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'SupplierItemsSpendLast buy',
      'MOHAMMED SAAHIL MUTTON4₹7,43,132.7029 Sep',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Branches' }));
    const branches = await screen.findByRole('table', { name: 'By branch' });
    expect(within(branches).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'BranchItemsSpendOutstanding',
      'Central Samco Kitchen - CSK41₹21,07,530.76₹21,06,765.76',
    ]);
  });

  it('IRW-6. Closing stock: the total by last purchase price, and each item at each branch', async () => {
    route.key = 'closing-stock';
    const row = { category: null, last_purchased_at: null };
    reports.closingStock.mockResolvedValue({
      summary: { items: 2, total_value_minor: 104_299_480, unpriced: 0, currency: 'INR' },
      rows: [
        { ...row, item_id: 'i1', branch_id: 'b2', branch: 'Central Samco Kitchen - CSK', name: 'Mutton Biriyani Cut', unit: 'Kg', quantity: 891.56, price_minor: 83_000, price_source: 'last_purchase', value_minor: 73_999_480 },
        { ...row, item_id: 'i2', branch_id: 'b1', branch: 'Alwarpet', name: 'Cardamom', unit: 'Kg', quantity: 100, price_minor: 303_000, price_source: 'item_price', value_minor: 30_300_000 },
      ],
    });
    render(<ReportPage />);
    const total = await screen.findByRole('region', { name: 'Total stock value' });
    expect(within(total).getByText('₹10,42,994.80')).toBeTruthy();
    expect(within(total).getByText('Method: last purchase price · 2 items · 1 at list price')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Stock on hand' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Item', 'Branch', 'Qty', 'Last Price', 'Value']);
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([
      'Mutton Biriyani CutCentral Samco Kitchen - CSK891.56 Kg₹830.00₹7,39,994.80',
      'CardamomAlwarpet100 Kg₹3,030.00list₹3,03,000.00',
    ]);
    expect(screen.queryByPlaceholderText('Search items')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Branch: All branches' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Branch' })).getByText('Alwarpet'));
    await waitFor(() => expect(reports.closingStock).toHaveBeenLastCalledWith({ companyId: 'co-1' }, { branch_id: 'b1' }));
  });

  it('IRW-7. Stock transfers: the last 7 days, the two totals, a card per movement, and export', async () => {
    route.key = 'transfers';
    const at = '2026-09-29T07:01:00.000Z';
    reports.transfers.mockResolvedValue({
      summary: { transfers: 16, lines: 2, value_minor: 265_500, currency: 'INR' },
      rows: [
        { id: 't1', date: '2026-09-29', created_at: at, number: 'TR-260929-2', from: 'Masala Central', to: 'Mogappair', item: 'American Garden Bbq Sauce', quantity: 9, unit: 'Piece', kind: 'RAW', value_minor: 265_500 },
        { id: 't2', date: '2026-09-29', created_at: at, number: 'TR-260929-1', from: 'Alwarpet', to: 'Anna Nagar', item: 'Appam Batter', quantity: 2, unit: 'pcs', kind: 'PRODUCT', value_minor: null },
      ],
      meta: { total: 2, limit: 100, offset: 0 },
    });
    render(<ReportPage />);
    expect(await screen.findByRole('heading', { name: 'Stock Transfers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dates: 23 Sep – 29 Sep 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Branch: All Branches' })).toBeTruthy();
    expect(reports.transfers).toHaveBeenLastCalledWith({ companyId: 'co-1' }, { from: '2026-09-23', to: '2026-09-29', limit: 100 });
    expect(within(await screen.findByRole('region', { name: 'Transfers' })).getByText('16')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Value moved' })).getByText('₹2,655.00')).toBeTruthy();

    const cards = within(screen.getByRole('list', { name: 'Movements' })).getAllByRole('listitem');
    expect(cards[0].textContent).toMatch(/^American Garden Bbq Sauce — 9 PieceMasala Central → Mogappair · 29 Sep, \d{1,2}:\d{2} [AP]M₹2,655\.00$/);
    expect(cards[1].textContent).toMatch(/^Appam Batter — 2 pcsProductAlwarpet → Anna Nagar · 29 Sep, .*—$/);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(files.saveFile).toHaveBeenCalled());
    const saved = files.saveFile.mock.calls[0][0];
    expect(saved.filename).toBe('stock-transfers-2026-09-23-to-2026-09-29.csv');
    const csv = (await saved.blob.text()).split('\n');
    expect(csv[0]).toBe('Date,Time,Transfer,From,To,Item,Type,Qty,Unit,Value');
    expect(csv[1]).toMatch(/^2026-09-29,.*,TR-260929-2,Masala Central,Mogappair,American Garden Bbq Sauce,Raw material,9,Piece,2655\.00$/);
    expect(csv[2]).toMatch(/,Appam Batter,Product,2,pcs,$/);
  });
});

describe('periods', () => {
  it('a month, and the one before, as the reports label them', () => {
    expect(monthOf('2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthOf('2026-03-10', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2026-01-15', 1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeLabel('2026-09-01', '2026-09-30')).toBe('1 Sep → 30 Sep');
    expect(lastDays('2026-09-29', 7)).toEqual({ from: '2026-09-23', to: '2026-09-29' });
    expect(lastDays('2026-03-02', 7)).toEqual({ from: '2026-02-24', to: '2026-03-02' });
    expect(rangeDash('2026-09-23', '2026-09-29')).toBe('23 Sep – 29 Sep 2026');
  });
});

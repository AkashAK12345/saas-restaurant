import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReportMetric, ReportResponse } from '@/lib/reports/types';

const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reports/api', () => ({ reportsApi: { run: (...a: unknown[]) => run(...a) } }));

vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    selectedBranch: { id: 'br-1', name: 'Alwarpet', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
  }),
}));

const { default: PosReportsPage } = await import('@/app/(staff)/(app)/reports/pos/page');
const { hourlySeries, longDateLabel, presetRange, rangeLabel } = await import('@/lib/reports/pos-ui');

function response(key: string, rows: ReportResponse['rows'], metrics: ReportMetric[] = []): ReportResponse {
  return {
    key,
    name: key,
    description: '',
    domain: 'pos',
    kind: 'summary',
    generated_at: '2026-09-24T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
    filters: { branch_id: 'br-1', from: '2026-09-24', to: '2026-09-24', options: {} },
    columns: [],
    option_specs: [],
    exportable: true,
    metrics,
    rows,
    meta: { total: rows.length, limit: 50, offset: 0 },
  };
}

const money = (key: string, label: string, value: number): ReportMetric => ({
  key,
  label,
  value,
  type: 'money',
  currency: 'INR',
});
const num = (key: string, label: string, value: number | string | null, type: ReportMetric['type'] = 'number') => ({
  key,
  label,
  value,
  type,
});

const EMPTY_SUMMARY = [
  money('total_revenue', 'Total Revenue', 0),
  num('paid_orders', 'Paid Orders', 0),
  num('total_orders', 'Total Orders', 0),
  num('dine_in', 'Dine In', 0),
  num('takeaway', 'Takeaway', 0),
  money('avg_order', 'Avg Order', 0),
  num('cancelled', 'Cancelled', 0),
  num('success_rate', 'Success Rate', 0, 'percent'),
];

const EMPTY_ANALYTICS = [
  money('revenue', 'Revenue', 0),
  num('paid_orders', 'Paid Orders', 0),
  money('avg_order', 'Avg Order', 0),
  num('all_orders', 'All Orders', 0),
  num('cancelled', 'Cancelled', 0),
  num('peak_hour', 'Peak Hour', null, 'string'),
];

function answerEmpty() {
  run.mockImplementation(async (_ctx: unknown, key: string) => {
    if (key === 'pos.summary') return response(key, [], EMPTY_SUMMARY);
    if (key === 'pos.analytics') return response(key, [], EMPTY_ANALYTICS);
    return response(key, []);
  });
}

const cards = (container: HTMLElement) =>
  [...container.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.parentElement?.querySelector('dd')?.textContent]);

describe('POS Reports screen', () => {
  beforeEach(() => {
    run.mockReset();
    answerEmpty();
  });

  it('PR-1. Summary: the day, a revenue card, six cards and no payments — as the reference shows an empty day', async () => {
    const { container } = render(<PosReportsPage />);
    expect(await screen.findByText('Total Revenue')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'POS Reports' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true');
    const hero = screen.getByText('Total Revenue').parentElement!;
    expect(within(hero).getByText('₹0.00')).toBeTruthy();
    expect(within(hero).getByText('0 paid orders')).toBeTruthy();
    expect(cards(container)).toEqual([
      ['Total Orders', '0'],
      ['Dine In', '0'],
      ['Takeaway', '0'],
      ['Avg Order', '₹0.00'],
      ['Cancelled', '0'],
      ['Success Rate', '0%'],
    ]);
    expect(screen.getByText('No payments recorded')).toBeTruthy();
    // One day, the branch's today.
    const [, key, query] = run.mock.calls[0];
    expect(key).toBe('pos.summary');
    expect(query.from).toBe(query.to);
  });

  it('PR-2. Summary lists payment methods when there are some', async () => {
    run.mockImplementation(async (_ctx: unknown, key: string) =>
      response(key, [{ method: 'UPI', orders: 3, amount_minor: 90_000, currency: 'INR' }], EMPTY_SUMMARY),
    );
    render(<PosReportsPage />);
    const row = (await screen.findByText('UPI')).closest('li')!;
    expect(within(row).getByText('3 orders')).toBeTruthy();
    expect(within(row).getByText('₹900.00')).toBeTruthy();
  });

  it('PR-3. Orders: "No orders found" for an empty day; each order as a card when there are some', async () => {
    render(<PosReportsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Orders' }));
    expect(await screen.findByText('No orders found')).toBeTruthy();

    run.mockImplementation(async (_ctx: unknown, key: string) =>
      response(key, [
        {
          order_number: 'A-101',
          opened_at: '2026-09-24T07:30:00.000Z',
          order_type: 'DINE_IN',
          table_label: 'T4',
          items: 3,
          total_minor: 60_000,
          currency: 'INR',
          payment: 'Card, Cash',
          status: 'PAID',
        },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const card = (await screen.findByText('#A-101')).closest('li')!;
    expect(within(card).getByText('Paid')).toBeTruthy();
    expect(within(card).getByText('₹600.00')).toBeTruthy();
    expect(within(card).getByText(/Dine In · T4/)).toBeTruthy();
    expect(within(card).getByText('3 items · Card, Cash')).toBeTruthy();
    expect(run.mock.calls.at(-1)?.[2]).toMatchObject({ limit: 100 });
  });

  it('PR-4. Analytics: presets, six cards, and every panel empty on a quiet day', async () => {
    const { container } = render(<PosReportsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Analytics' }));
    await waitFor(() => expect(screen.getAllByText('No paid orders in this range')).toHaveLength(2));
    expect(screen.getByText('No items sold in this range')).toBeTruthy();
    expect(cards(container).map(([label]) => label)).toEqual([
      'Revenue',
      'Paid Orders',
      'Avg Order',
      'All Orders',
      'Cancelled',
      'Peak Hour',
    ]);
    expect(cards(container).find(([l]) => l === 'Peak Hour')?.[1]).toBe('—');
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/· Alwarpet/)).toBeTruthy();

    run.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '7 Days' }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    const query = run.mock.calls[0][2];
    expect(presetRange('7d', query.to)).toEqual({ from: query.from, to: query.to });
  });

  it('PR-5. Custom opens "Select Date Range"; Apply runs that range, Cancel changes nothing', async () => {
    render(<PosReportsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Analytics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const dialog = screen.getByRole('dialog', { name: 'Select Date Range' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const again = screen.getByRole('dialog', { name: 'Select Date Range' });
    fireEvent.change(within(again).getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(within(again).getByLabelText('To'), { target: { value: '2026-09-10' } });
    run.mockClear();
    fireEvent.click(within(again).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(run.mock.calls.find((c) => c[1] === 'pos.analytics')?.[2]).toMatchObject({
        from: '2026-09-01',
        to: '2026-09-10',
      }),
    );
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/1 Sep – 10 Sep 2026/)).toBeTruthy();
  });

  it('PR-6. Analytics charts: bars by hour and a split by order type', async () => {
    run.mockImplementation(async (_ctx: unknown, key: string) => {
      if (key === 'pos.revenue_by_hour') {
        return response(key, [
          { hour: 13, hour_label: '1 PM', orders: 1, revenue_minor: 60_000, currency: 'INR' },
          { hour: 15, hour_label: '3 PM', orders: 1, revenue_minor: 90_000, currency: 'INR' },
        ]);
      }
      if (key === 'pos.revenue_by_type') {
        return response(key, [
          { order_type: 'Takeaway', orders: 1, revenue_minor: 90_000, currency: 'INR' },
          { order_type: 'Dine In', orders: 1, revenue_minor: 60_000, currency: 'INR' },
        ]);
      }
      return response(key, [{ item: 'Chicken Biryani', quantity: 5, revenue_minor: 125_000, currency: 'INR' }], [
        money('revenue', 'Revenue', 150_000),
      ]);
    });
    render(<PosReportsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Analytics' }));
    // The gap at 2 PM is drawn as an empty hour.
    expect(await screen.findByLabelText('2 PM: ₹0.00')).toBeTruthy();
    expect(screen.getByLabelText('3 PM: ₹900.00')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Revenue by order type' })).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('Chicken Biryani')).toBeTruthy();
  });

  it('PR-7. a refused report is shown, not silently empty', async () => {
    run.mockRejectedValue(new Error('You do not have permission to view POS reports'));
    render(<PosReportsPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('permission');
  });
});

describe('POS Reports helpers', () => {
  it('labels days and ranges', () => {
    expect(longDateLabel('2026-09-24')).toBe('Thursday, 24 September 2026');
    expect(rangeLabel('2026-09-24', '2026-09-24')).toBe('24 Sep 2026');
    expect(rangeLabel('2026-09-18', '2026-09-24')).toBe('18 Sep – 24 Sep 2026');
    expect(rangeLabel('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 – 3 Jan 2026');
  });

  it('presets end today', () => {
    expect(presetRange('today', '2026-09-24')).toEqual({ from: '2026-09-24', to: '2026-09-24' });
    expect(presetRange('7d', '2026-09-24')).toEqual({ from: '2026-09-18', to: '2026-09-24' });
    expect(presetRange('30d', '2026-09-24')).toEqual({ from: '2026-08-26', to: '2026-09-24' });
  });

  it('fills the hours between the first and last sale', () => {
    expect(
      hourlySeries([
        { hour: 11, hour_label: '11 AM', revenue_minor: 5 },
        { hour: 13, hour_label: '1 PM', revenue_minor: 7 },
      ]).map((s) => [s.label, s.revenue]),
    ).toEqual([
      ['11 AM', 5],
      ['12 PM', 0],
      ['1 PM', 7],
    ]);
    expect(hourlySeries([])).toEqual([]);
  });
});

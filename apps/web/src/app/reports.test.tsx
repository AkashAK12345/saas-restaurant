import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { DashboardResponse, ReportResponse } from '@/lib/reports/types';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  describe: vi.fn(),
  run: vi.fn(),
  export: vi.fn(),
  dashboard: vi.fn(),
  dashboardAllBranches: vi.fn(),
}));

const saveFileMock = vi.hoisted(() => vi.fn());

const lazyProxy = vi.hoisted(
  () =>
    <T extends Record<string, (...args: never[]) => unknown>>(target: T) =>
      new Proxy(target, {
        get: (t, k: string) => (...a: unknown[]) =>
          (t[k] as unknown as (...args: unknown[]) => unknown)(...a),
      }),
);

vi.mock('@/lib/reports/api', () => ({
  reportsApi: lazyProxy(apiMock),
  saveFile: saveFileMock,
}));

let branchPermissions: string[] = [];
let selectedBranchId: string | null = 'br-1';
let selectedCompanyId: string | null = 'co-1';
let contextBranches: Array<{ id: string; name: string; timezone: string; status: string; has_roles: boolean }> = [];
let roleNames: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId,
    selectedBranchId,
    selectedBranch: { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    branches: contextBranches,
    companyPermissions: [],
    branchPermissions,
    roleNames,
    loading: false,
  }),
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ user: { first_name: 'Ana', email: 'ana@test.com' } }),
}));

let routeKey = 'queue.tokens';
vi.mock('next/navigation', () => ({
  usePathname: () => '/reports',
  useParams: () => ({ key: routeKey }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { default: ReportsPage } = await import('@/app/(staff)/(app)/reports/page');
const { default: ReportPage } = await import('@/app/(staff)/(app)/reports/[key]/page');
const { default: HomePage } = await import('@/app/(staff)/(app)/page');
const { formatMoney, formatDuration, formatValue, shiftDate } = await import(
  '@/lib/reports/format'
);
const { visibleNavItems } = await import('@/components/shell/nav');

/** Grouping separators and currency symbols are the viewer's locale, not ours. */
const digitsOf = (text: string) => text.replace(/[^0-9.]/g, '');

function reportResponse(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return {
    key: 'queue.tokens',
    name: 'Queue tokens',
    description: 'Every token issued in the period',
    domain: 'queue',
    kind: 'rows',
    generated_at: '2026-03-10T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
    filters: { branch_id: 'br-1', from: '2026-03-01', to: '2026-03-10', options: {} },
    columns: [
      { key: 'service_date', label: 'Date', type: 'date' },
      { key: 'token_number', label: 'Token', type: 'number' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'wait_seconds', label: 'Wait', type: 'duration' },
    ],
    option_specs: [{ key: 'status', label: 'Status', values: ['WAITING', 'SEATED'] }],
    exportable: true,
    metrics: [{ key: 'registered', label: 'Tokens registered', value: 2, type: 'number' }],
    rows: [
      { service_date: '2026-03-10', token_number: 1, status: 'SEATED', wait_seconds: 1800 },
      { service_date: '2026-03-10', token_number: 2, status: 'NO_SHOW', wait_seconds: null },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
    ...overrides,
  };
}

function dashboardResponse(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    branch_id: 'br-1',
    timezone: 'Asia/Kolkata',
    generated_at: '2026-03-10T09:00:00.000Z',
    filters: { from: '2026-03-01', to: '2026-03-10' },
    widgets: [
      {
        key: 'queue.today',
        title: 'Queue today',
        domain: 'queue',
        display: 'metrics',
        live: true,
        metrics: [
          { key: 'waiting', label: 'Waiting', value: 3, type: 'number', emphasis: 'warning' },
          { key: 'longest_wait', label: 'Longest wait', value: 900, type: 'duration' },
        ],
      },
      {
        key: 'banquet.overview',
        title: 'Banquet',
        domain: 'banquet',
        display: 'metrics',
        live: true,
        metrics: [
          {
            key: 'outstanding_INR',
            label: 'Outstanding (INR)',
            value: 10_000_000,
            type: 'money',
            currency: 'INR',
            emphasis: 'warning',
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  branchPermissions = ['reports.view', 'reports.export', 'dashboard.view', 'queue.view'];
  selectedCompanyId = 'co-1';
  selectedBranchId = 'br-1';
  contextBranches = [];
  roleNames = ['Manager'];
  routeKey = 'queue.tokens';
  apiMock.list.mockImplementation(async () => ({
    data: [
      {
        key: 'queue.summary',
        name: 'Queue summary',
        description: 'Outcomes per service date',
        domain: 'queue',
        scope: 'branch',
        kind: 'summary',
        columns: [],
        exportable: true,
      },
      {
        key: 'tasks.completion',
        name: 'Task completion',
        description: 'Tasks raised and finished',
        domain: 'tasks',
        scope: 'branch',
        kind: 'summary',
        columns: [],
        exportable: true,
      },
    ],
    meta: { total: 2 },
  }));
  apiMock.run.mockImplementation(async () => reportResponse());
  apiMock.dashboard.mockImplementation(async () => dashboardResponse());
  apiMock.export.mockImplementation(async () => ({
    blob: new Blob(['x']),
    filename: 'queue.tokens_2026-03-01_2026-03-10.xlsx',
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTING — the one place money is divided
// ═══════════════════════════════════════════════════════════════════════════

describe('report formatting', () => {
  it('RF-1. divides minor units exactly once, and never for anything else', () => {
    expect(formatMoney(150_000)).toBe('1500.00');
    expect(formatMoney(1)).toBe('0.01');
    expect(formatMoney(0)).toBe('0.00');
    // A count is not money and must not be divided. Digit grouping is the
    // viewer's locale (1,50,000 in en-IN, 150,000 in en-GB), so compare the
    // digits rather than pinning the test to whichever locale CI runs in.
    expect(digitsOf(formatValue(150_000, 'number'))).toBe('150000');
  });

  it('RF-2. shows an absent amount as a dash rather than zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatDuration(null)).toBe('—');
  });

  it('RF-3. renders a currency amount with its own currency', () => {
    const formatted = formatMoney(10_000_000, 'INR');
    expect(digitsOf(formatted)).toBe('100000.00');
    expect(formatted).toMatch(/[₹]|INR/);
    // An unrecognised code still shows a real amount, labelled, rather than
    // throwing or silently dropping the currency.
    const odd = formatMoney(150_000, 'XZZ');
    expect(digitsOf(odd)).toBe('1500.00');
    expect(odd).toContain('XZZ');
  });

  it('RF-4. formats durations for a human', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(1800)).toBe('30m 00s');
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  // Parsing a branch-local calendar date would re-apply the viewer's offset
  // and silently move the day; it is re-ordered as text into dd/MM/yyyy.
  it('RF-5. prints a branch-local date as dd/MM/yyyy without moving the day', () => {
    expect(formatValue('2026-03-10', 'date')).toBe('10/03/2026');
    expect(formatValue('2026-12-31', 'date', { timezone: 'Pacific/Kiritimati' })).toBe('31/12/2026');
  });

  it('RF-5b. shows an instant on the branch clock in en-IN', () => {
    // 18:45Z is 00:15 the next day in Kolkata.
    expect(formatValue('2026-03-10T18:45:00.000Z', 'datetime', { timezone: 'Asia/Kolkata' })).toMatch(
      /^11\/03\/2026, 12:15\s?am$/i,
    );
    expect(formatValue(150_000, 'number')).toBe('1,50,000');
  });

  it('RF-6. shifts calendar dates without a timezone getting involved', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-10', -30)).toBe('2026-02-08');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════

describe('reports catalogue', () => {
  it('RF-7. shows only what the server offered, grouped by domain', async () => {
    render(<ReportsPage />);

    const link = await screen.findByRole('link', { name: 'Queue summary' });
    expect(link.getAttribute('href')).toBe('/reports/queue.summary');
    expect(screen.getByRole('link', { name: 'Task completion' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Queue' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    // The page never invents an entry the server did not send.
    expect(screen.queryByText(/banquet/i)).toBeNull();
  });

  it('RF-8. says so plainly when nothing is available', async () => {
    apiMock.list.mockImplementation(async () => ({ data: [], meta: { total: 0 } }));
    render(<ReportsPage />);
    expect(await screen.findByText(/no reports are available/i)).toBeTruthy();
  });

  it('RF-9. surfaces a refusal instead of rendering an empty page', async () => {
    apiMock.list.mockImplementation(async () => {
      throw new Error('Forbidden');
    });
    render(<ReportsPage />);
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch('Forbidden');
  });

  it('RF-10. asks for nothing until a branch is selected', () => {
    selectedBranchId = null;
    render(<ReportsPage />);
    expect(apiMock.list).not.toHaveBeenCalled();
    expect(screen.getByText(/select a company and branch/i)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORT VIEW
// ═══════════════════════════════════════════════════════════════════════════

describe('report view', () => {
  it('RF-11. renders whatever columns the report declared', async () => {
    render(<ReportPage />);

    await screen.findByRole('table');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Date', 'Token', 'Status', 'Wait']);

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('30m 00s')).toBeTruthy();
    // A missing duration is a dash, not "0s".
    expect(within(rows[1]).getByText('—')).toBeTruthy();
  });

  it('RF-12. lets the SERVER choose the first window rather than guessing it', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(apiMock.run.mock.calls[0][2]).toMatchObject({ from: '', to: '' });
    // The pickers then adopt the branch-local dates the server actually used.
    await waitFor(() => {
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-03-01');
    });
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-03-10');
  });

  it('RF-13. shows the branch timezone the dates belong to', async () => {
    render(<ReportPage />);
    expect(await screen.findByText(/01\/03\/2026 to 10\/03\/2026 · Asia\/Kolkata/)).toBeTruthy();
  });

  it('RF-13b. Run asks the server again even when nothing in the form changed', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(false));
    apiMock.run.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(apiMock.run).toHaveBeenCalledTimes(1));
  });

  it('RF-13c. links a row to its record when the report declares a drill-down', async () => {
    apiMock.run.mockImplementation(async () =>
      reportResponse({
        key: 'banquet.bookings',
        columns: [
          { key: 'starts_at', label: 'Event', type: 'datetime' },
          { key: 'customer_name', label: 'Customer', type: 'string' },
        ],
        option_specs: [],
        drilldown: { id_key: 'booking_id', path: '/banquet/:id' },
        rows: [
          { booking_id: 'bk-42', starts_at: '2026-03-10T06:00:00.000Z', customer_name: 'Priya' },
          { booking_id: '../../admin', starts_at: '2026-03-10T07:00:00.000Z', customer_name: 'Odd id' },
        ],
      }),
    );
    render(<ReportPage />);
    await screen.findByRole('table');
    const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/banquet/'));
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/banquet/bk-42']);
    expect(links[0].textContent).toMatch(/^10\/03\/2026, 11:30\s?am$/i);
  });

  it('RF-14. offers only the filters the report declared', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'WAITING', 'SEATED']);
    // No free-text filter box exists to type an arbitrary value into.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('RF-15. sends a filter change to the SERVER', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');
    apiMock.run.mockClear();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SEATED' } });

    await waitFor(() => expect(apiMock.run).toHaveBeenCalled());
    expect(apiMock.run.mock.calls.at(-1)?.[2]).toMatchObject({ options: { status: 'SEATED' } });
  });

  it('RF-16. paginates against the server, never in the browser', async () => {
    apiMock.run.mockImplementation(async () =>
      reportResponse({ meta: { total: 120, limit: 50, offset: 0 } }),
    );
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(screen.getByText(/showing 1–2 of 120/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);

    apiMock.run.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(apiMock.run).toHaveBeenCalled());
    expect(apiMock.run.mock.calls.at(-1)?.[2]).toMatchObject({ offset: 50, limit: 50 });
  });

  it('RF-17. does not paginate a summary report', async () => {
    apiMock.run.mockImplementation(async () =>
      reportResponse({ kind: 'summary', option_specs: [] }),
    );
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('RF-18. shows an empty period honestly', async () => {
    apiMock.run.mockImplementation(async () =>
      reportResponse({ rows: [], meta: { total: 0, limit: 50, offset: 0 } }),
    );
    render(<ReportPage />);
    expect(await screen.findByText(/no data for this period/i)).toBeTruthy();
  });

  it('RF-19. reports a failure rather than showing stale numbers', async () => {
    apiMock.run.mockImplementation(async () => {
      throw new Error('Date range must not exceed 366 days');
    });
    render(<ReportPage />);

    expect((await screen.findByRole('alert')).textContent ?? '').toMatch('366 days');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE REPORTS — the titled, searchable panel and its status pills
// ═══════════════════════════════════════════════════════════════════════════

function queueTokensResponse(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return reportResponse({
    name: 'Queue Reports',
    columns: [
      { key: 'token_number', label: 'Token', type: 'number' },
      { key: 'customer_name', label: 'Customer', type: 'string' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'wait_seconds', label: 'Wait/Reason', type: 'duration' },
      { key: 'operator_email', label: 'Operator', type: 'string' },
    ],
    metrics: [
      { key: 'total_customers', label: 'Total Customers', value: 2, type: 'number' },
      { key: 'avg_wait_seconds', label: 'Avg Wait Time', value: 1800, type: 'duration' },
      { key: 'total_pax', label: 'Total PAX', value: 4, type: 'number' },
      { key: 'avg_pax', label: 'Avg PAX', value: 2, type: 'number' },
    ],
    rows: [
      {
        token_number: 1,
        customer_name: 'srinivasan',
        status: 'SEATED',
        wait_seconds: 1800,
        operator_email: 'pallavaramba@gmail.com',
      },
      {
        token_number: 2,
        customer_name: 'jenitha',
        status: 'NO_SHOW',
        wait_seconds: null,
        operator_email: 'pallavaramba@gmail.com',
      },
    ],
    ...overrides,
  });
}

describe('queue.tokens report panel', () => {
  it('RF-40. titles the table "Queue Log" with its entry count, inside a panel', async () => {
    apiMock.run.mockImplementation(async () => queueTokensResponse());
    render(<ReportPage />);

    await screen.findByRole('table');
    expect(screen.getByText('Queue Log')).toBeTruthy();
    expect(screen.getByText('2 entries')).toBeTruthy();
  });

  it('RF-41. shows each status as a coloured pill, not the raw enum text', async () => {
    apiMock.run.mockImplementation(async () => queueTokensResponse());
    render(<ReportPage />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Seated').getAttribute('data-tone')).toBe('success');
    expect(within(rows[1]).getByText('No show').getAttribute('data-tone')).toBe('danger');
    // The raw enum value never reaches the TABLE (the Status filter
    // dropdown legitimately lists it as a choice — see RF-14).
    expect(within(table).queryByText('SEATED')).toBeNull();
    expect(within(table).queryByText('NO_SHOW')).toBeNull();
  });

  it('RF-42. an unrecognised status still shows as text rather than vanishing', async () => {
    apiMock.run.mockImplementation(async () =>
      queueTokensResponse({ rows: [{ token_number: 9, status: 'SOMETHING_NEW', customer_name: 'x' }] }),
    );
    render(<ReportPage />);
    expect(await screen.findByText('SOMETHING_NEW')).toBeTruthy();
  });

  it('RF-43. gives each headline metric its own coloured icon', async () => {
    apiMock.run.mockImplementation(async () => queueTokensResponse());
    const { container } = render(<ReportPage />);
    await screen.findByRole('table');

    const icons = container.querySelectorAll('[data-tone="blue"], [data-tone="amber"], [data-tone="green"], [data-tone="terracotta"]');
    // Four metrics, four tones — one icon badge per headline figure.
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });

  it('RF-44. the search box filters the rows already on screen by customer, without asking the server again', async () => {
    apiMock.run.mockImplementation(async () => queueTokensResponse());
    render(<ReportPage />);
    await screen.findByRole('table');
    apiMock.run.mockClear();

    fireEvent.change(screen.getByPlaceholderText('Search customer…'), { target: { value: 'jeni' } });

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(2); // header + one match
    });
    expect(screen.getByText('jenitha')).toBeTruthy();
    expect(screen.queryByText('srinivasan')).toBeNull();
    expect(apiMock.run).not.toHaveBeenCalled();
  });

  it('RF-45. a report other than queue.tokens gets the plain layout, with no panel or icons', async () => {
    routeKey = 'banquet.bookings';
    apiMock.run.mockImplementation(async () =>
      reportResponse({
        key: 'banquet.bookings',
        columns: [{ key: 'customer_name', label: 'Customer', type: 'string' }],
        metrics: [{ key: 'total_pax', label: 'Total PAX', value: 4, type: 'number' }],
        rows: [{ customer_name: 'Priya' }],
        option_specs: [],
      }),
    );
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(screen.queryByPlaceholderText(/Search/)).toBeNull();
    expect(screen.queryByText(/entries$/)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

describe('report export', () => {
  it('RF-20. downloads the file the server named', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));

    await waitFor(() => expect(saveFileMock).toHaveBeenCalled());
    expect(apiMock.export.mock.calls[0][2]).toBe('xlsx');
    expect(await screen.findByText(/queue\.tokens_2026-03-01_2026-03-10\.xlsx/)).toBeTruthy();
  });

  // A file holding only page one would be worse than no file.
  it('RF-21. exports the whole filtered set, not the page on screen', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SEATED' } });
    // Wait for the filtered query to reach the server rather than counting
    // calls: an exact count would encode whatever refetching the page happens
    // to do today, which is how the double-fetch bug hid here in the first
    // place.
    await waitFor(() =>
      expect(apiMock.run.mock.calls.at(-1)?.[2]).toMatchObject({ options: { status: 'SEATED' } }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    await waitFor(() => expect(apiMock.export).toHaveBeenCalled());
    const query = apiMock.export.mock.calls[0][3];
    expect(query).toMatchObject({ options: { status: 'SEATED' } });
    expect(query).not.toHaveProperty('offset');
    expect(query).not.toHaveProperty('limit');
  });

  it('RF-22. hides export from a caller without reports.export', async () => {
    branchPermissions = ['reports.view', 'queue.view'];
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Export Excel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
  });

  it('RF-23. surfaces a refused export without losing the report', async () => {
    apiMock.export.mockImplementation(async () => {
      throw new Error('You do not have access to the banquet data');
    });
    render(<ReportPage />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));

    expect((await screen.findByRole('alert')).textContent ?? '').toMatch('do not have access');
    expect(screen.getByRole('table')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

describe('dashboard', () => {
  it('RF-24. fills the whole page from ONE request', async () => {
    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: 'Queue today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Banquet' })).toBeTruthy();
    expect(apiMock.dashboard).toHaveBeenCalledTimes(1);
  });

  it('RF-25. formats each widget metric by its declared type', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('15m 00s')).toBeTruthy();
    expect(screen.getByText((text) => digitsOf(text) === '100000.00')).toBeTruthy();
  });

  it('RF-26. marks a live widget so the reader is not misled', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });
    expect(screen.getAllByText('Right now')).toHaveLength(2);
  });

  it('RF-27. renders the other widgets when one of them failed', async () => {
    const failing = dashboardResponse();
    failing.widgets[1] = { ...failing.widgets[1], metrics: [], error: 'This widget could not be loaded' };
    apiMock.dashboard.mockImplementation(async () => failing);

    render(<HomePage />);

    expect(await screen.findByRole('heading', { name: 'Queue today' })).toBeTruthy();
    expect((screen.getByRole('alert')).textContent ?? '').toMatch('could not be loaded');
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('RF-28. asks for no dashboard without dashboard.view, but still offers the modules', () => {
    branchPermissions = ['queue.view'];
    render(<HomePage />);

    expect(apiMock.dashboard).not.toHaveBeenCalled();
    // No widgets, but not a dead end: the workspace launcher shows exactly the
    // modules this permission set can open, and nothing else.
    expect(screen.getByRole('heading', { name: /your workspace/i })).toBeTruthy();
    // Queue opens a sheet of its screens rather than navigating straight away.
    expect(screen.getByRole('button', { name: /queue/i }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('link', { name: /banquet/i })).toBeNull();
  });


  it('RF-28b. greets by the role held here, falling back to the name when there is none', () => {
    roleNames = ['Manager'];
    const { unmount } = render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /^Good (Morning|Afternoon|Evening), Manager$/,
    );
    unmount();

    // Two jobs at once are both named; no role at all falls back to the person.
    roleNames = ['Chef', 'Manager'];
    const both = render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/, Chef, Manager$/);
    both.unmount();

    roleNames = [];
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/, Ana$/);
  });

  it('RF-29. asks for nothing until a branch is selected', () => {
    selectedBranchId = null;
    render(<HomePage />);

    expect(apiMock.dashboard).not.toHaveBeenCalled();
    expect(screen.getByText(/select a branch/i)).toBeTruthy();
  });

  it('RF-30. reports a dashboard failure rather than an empty page', async () => {
    apiMock.dashboard.mockImplementation(async () => {
      throw new Error('Forbidden');
    });
    render(<HomePage />);
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch('Forbidden');
  });

  it('RF-30b. a period preset asks the server for that branch-local window', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });
    // The default is the server's own 30-day window: no dates are guessed.
    expect(apiMock.dashboard.mock.calls[0].slice(1)).toEqual([undefined, undefined]);

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(apiMock.dashboard).toHaveBeenCalledTimes(2));
    const [, from, to] = apiMock.dashboard.mock.calls[1] as [unknown, string, string];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(apiMock.dashboard).toHaveBeenCalledTimes(3));
    const [, dayFrom, dayTo] = apiMock.dashboard.mock.calls[2] as [unknown, string, string];
    expect(dayFrom).toBe(dayTo);
  });

  it('RF-30c. offers All branches only with more than one branch, and shows the sums with a per-branch breakdown', async () => {
    const { unmount } = render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });
    expect(screen.queryByRole('button', { name: 'All branches' })).toBeNull();
    unmount();

    contextBranches = [
      { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
      { id: 'br-2', name: 'Alpha Second', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    ];
    apiMock.dashboardAllBranches.mockResolvedValue({
      scope: 'all_branches',
      company_id: 'co-1',
      generated_at: '',
      filters: { from: null, to: null },
      branches: [
        { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata' },
        { id: 'br-2', name: 'Alpha Second', timezone: 'Asia/Kolkata' },
      ],
      widgets: [
        {
          key: 'queue.today',
          title: 'Queue today',
          domain: 'queue',
          display: 'metrics',
          live: true,
          metrics: [{ key: 'waiting', label: 'Waiting', value: 7, type: 'number' }],
          not_summed: ['Longest wait'],
          branches: [
            { branch_id: 'br-1', branch_name: 'Alpha Main', metrics: [{ key: 'waiting', label: 'Waiting', value: 3, type: 'number' }] },
            { branch_id: 'br-2', branch_name: 'Alpha Second', metrics: [{ key: 'waiting', label: 'Waiting', value: 4, type: 'number' }] },
          ],
        },
      ],
    });
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });
    fireEvent.click(screen.getByRole('button', { name: 'All branches' }));

    await waitFor(() => expect(apiMock.dashboardAllBranches).toHaveBeenCalledWith({ companyId: 'co-1' }, undefined, undefined));
    expect(await screen.findByText(/Totals across 2 branches: Alpha Main, Alpha Second/)).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText(/Not added across branches: Longest wait/)).toBeTruthy();
    // The comparison matrix: All branches, then one column per branch.
    const matrix = screen.getByRole('table', { name: 'Queue today by branch' });
    const headers = within(matrix).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Figure', 'All branches', 'Alpha Main', 'Alpha Second']);
    const waitingRow = within(matrix).getByRole('row', { name: /Waiting/ });
    expect(within(waitingRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['7', '3', '4']);
  });

  it('RF-30d. a custom period is sent exactly as chosen, and an impossible one is not sent', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Queue today' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    const form = screen.getByRole('form', { name: 'Custom period' });
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-03-10' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-03-01' } });
    expect(within(form).getByText('The start date must not be after the end date.')).toBeTruthy();
    expect((within(form).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2027-06-01' } });
    expect(within(form).getByText('A period may cover at most 366 days.')).toBeTruthy();

    const calls = apiMock.dashboard.mock.calls.length;
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-03-20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(apiMock.dashboard.mock.calls.length).toBeGreaterThan(calls));
    expect(apiMock.dashboard.mock.calls.at(-1)!.slice(1)).toEqual(['2026-03-10', '2026-03-20']);
  });

  it('RF-30e. a daily series draws one bar per day, switches figure, and offers the numbers as a table', async () => {
    apiMock.dashboard.mockResolvedValue(
      dashboardResponse({
        widgets: [
          {
            key: 'queue.daily',
            title: 'Daily queue',
            domain: 'queue',
            display: 'series',
            live: false,
            metrics: [],
            series: {
              keys: [
                { key: 'registered', label: 'Walked in' },
                { key: 'no_show', label: 'No-shows' },
              ],
              points: [
                { date: '2026-03-09', values: { registered: 4, no_show: 0 } },
                { date: '2026-03-10', values: { registered: 9, no_show: 2 } },
                { date: '2026-03-11', values: { registered: 0, no_show: 0 } },
              ],
            },
          },
        ],
      }),
    );
    render(<HomePage />);
    const chart = await screen.findByRole('img', { name: /Daily queue: Walked in per day/ });
    expect(chart.getAttribute('aria-label')).toMatch(/highest 9 on/);
    expect(chart.children).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Figure'), { target: { value: 'no_show' } });
    expect(screen.getByRole('img', { name: /No-shows per day/ }).getAttribute('aria-label')).toMatch(/highest 2 on/);

    const table = screen.getByRole('table', { name: 'Daily queue by day' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

describe('navigation', () => {
  it('RF-31. shows Reports only with reports.view and a selected branch', () => {
    const withPerm = visibleNavItems(['reports.view'], true).map((i) => i.href);
    expect(withPerm).toContain('/reports');

    expect(visibleNavItems(['reports.view'], false).map((i) => i.href)).not.toContain('/reports');
    expect(visibleNavItems(['queue.view'], true).map((i) => i.href)).not.toContain('/reports');
  });
});

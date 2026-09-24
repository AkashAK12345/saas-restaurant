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
// The details view reads the task itself; only those two calls are faked.
const tasksApiMock = vi.hoisted(() => ({ get: vi.fn(), listItemPhotos: vi.fn(async () => []) }));
vi.mock('@/lib/tasks/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tasks/api')>();
  return { ...actual, tasksApi: { ...actual.tasksApi, ...tasksApiMock } };
});

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
    // queue.tokens (the default route here) sits in a titled panel, which
    // uses the reference design's icon-and-line empty state.
    apiMock.run.mockImplementation(async () =>
      reportResponse({ rows: [], meta: { total: 0, limit: 50, offset: 0 } }),
    );
    const { unmount } = render(<ReportPage />);
    expect(await screen.findByText(/no data found/i)).toBeTruthy();
    unmount();

    // A report with no panel keeps the plain wording.
    routeKey = 'banquet.payments';
    apiMock.run.mockImplementation(async () =>
      reportResponse({ key: 'banquet.payments', rows: [], meta: { total: 0, limit: 50, offset: 0 } }),
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

  it('RF-45. a report with no UI hint gets the plain layout, with no panel or icons', async () => {
    routeKey = 'banquet.payments';
    apiMock.run.mockImplementation(async () =>
      reportResponse({
        key: 'banquet.payments',
        columns: [{ key: 'method', label: 'Method', type: 'string' }],
        metrics: [{ key: 'total_pax', label: 'Total PAX', value: 4, type: 'number' }],
        rows: [{ method: 'cash' }],
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
// BANQUET REPORTS — the four headline cards, and a balance coloured by sign
// ═══════════════════════════════════════════════════════════════════════════

function banquetBookingsResponse(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return reportResponse({
    key: 'banquet.bookings',
    name: 'Banquet Reports',
    columns: [
      { key: 'event_date', label: 'Date', type: 'date' },
      { key: 'customer_name', label: 'Customer', type: 'string' },
      { key: 'hall_name', label: 'Hall', type: 'string' },
      { key: 'balance_minor', label: 'Balance', type: 'money' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    // The full, unfiltered set the backend actually emits — the page must
    // narrow this to four cards on its own, not rely on the server having
    // sent exactly four.
    metrics: [
      { key: 'bookings', label: 'Events', value: 146, type: 'number' },
      { key: 'total_bookings', label: 'Total Bookings', value: 146, type: 'number' },
      { key: 'confirmed', label: 'Confirmed', value: 98, type: 'number' },
      { key: 'drafts', label: 'Drafts', value: 48, type: 'number' },
      { key: 'balance_INR', label: 'Balance due (INR)', value: 500, type: 'money', currency: 'INR' },
      { key: 'revenue_INR', label: 'Revenue (INR)', value: 5_755_662_00, type: 'money', currency: 'INR' },
    ],
    rows: [
      {
        event_date: '2026-09-23',
        customer_name: 'test1',
        hall_name: 'D hall',
        balance_minor: 3196000,
        status: 'CONFIRMED',
      },
      {
        event_date: '2026-09-22',
        customer_name: 'button garments',
        hall_name: '3rd FLOOR',
        balance_minor: -494000,
        status: 'CONFIRMED',
      },
    ],
    ...overrides,
  });
}

describe('banquet.bookings report panel', () => {
  it('RF-46. shows only the four headline cards, not the full metric set the server sent', async () => {
    routeKey = 'banquet.bookings';
    apiMock.run.mockImplementation(async () => banquetBookingsResponse());
    const { container } = render(<ReportPage />);
    await screen.findByRole('table');

    const cardLabels = [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(cardLabels).toEqual(['Total Bookings', 'Confirmed', 'Drafts', 'Revenue (INR)']);
  });

  it('RF-47. colours a balance still owed differently from one that is overpaid', async () => {
    routeKey = 'banquet.bookings';
    apiMock.run.mockImplementation(async () => banquetBookingsResponse());
    render(<ReportPage />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    // Owed (positive balance_minor) reads as a warning; overpaid (negative) as fine.
    expect(rows[0].querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('danger');
    expect(rows[1].querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('success');
  });

  it('RF-48. titles the table "Bookings" and its search box matches the hall too', async () => {
    routeKey = 'banquet.bookings';
    apiMock.run.mockImplementation(async () => banquetBookingsResponse());
    render(<ReportPage />);
    await screen.findByRole('table');
    expect(screen.getByText('Bookings')).toBeTruthy();
    expect(screen.getByText('2 entries')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'FLOOR' } });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getByText('button garments')).toBeTruthy();
    expect(screen.queryByText('test1')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TASK REPORTS — filter chips that ask the server, and the empty log
// ═══════════════════════════════════════════════════════════════════════════

function tasksLogResponse(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return reportResponse({
    key: 'tasks.log',
    name: 'Task Reports',
    columns: [
      { key: 'title', label: 'Task', type: 'string' },
      { key: 'assignee_name', label: 'Assignee', type: 'string' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'priority', label: 'Priority', type: 'badge' },
      { key: 'checklist', label: 'Checklist', type: 'string' },
    ],
    option_specs: [
      { key: 'view', label: 'Show', values: ['COMPLETED', 'IN_PROGRESS', 'ASSIGNED', 'INCOMPLETE', 'OVERDUE'] },
    ],
    metrics: [
      { key: 'total_tasks', label: 'Total Tasks', value: 2, type: 'number' },
      { key: 'completed', label: 'Completed', value: 1, type: 'number' },
      { key: 'pending', label: 'Pending', value: 1, type: 'number' },
      { key: 'overdue', label: 'Overdue', value: 1, type: 'number' },
    ],
    rows: [
      { title: 'Clean the fryer', assignee_name: 'Ana Lyst', status: 'COMPLETED', priority: 'NORMAL', checklist: '2/2' },
      { title: 'Restock napkins', assignee_name: 'Unassigned', status: 'PENDING', priority: 'HIGH', checklist: null },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
    ...overrides,
  });
}

describe('tasks.log report panel', () => {
  beforeEach(() => {
    routeKey = 'tasks.log';
    apiMock.run.mockImplementation(async () => tasksLogResponse());
  });

  const chips = () =>
    within(screen.getByRole('group', { name: 'Filter the log' })).getAllByRole('button');

  it('RF-49. offers the reference chips, starting on All, with no "Pending Approval"', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');

    expect(chips().map((c) => c.textContent)).toEqual([
      'All',
      'Completed',
      'In Progress',
      'Assigned',
      'Incomplete',
      'Overdue',
    ]);
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Pending Approval')).toBeNull();
  });

  it('RF-50. a chip filters on the SERVER, and All clears it', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');
    apiMock.run.mockClear();

    fireEvent.click(chips().find((c) => c.textContent === 'Overdue')!);
    await waitFor(() => expect(apiMock.run).toHaveBeenCalled());
    expect(apiMock.run.mock.calls.at(-1)?.[2]).toMatchObject({ options: { view: 'OVERDUE' }, offset: 0 });
    await waitFor(() =>
      expect(chips().find((c) => c.textContent === 'Overdue')!.getAttribute('aria-pressed')).toBe('true'),
    );

    apiMock.run.mockClear();
    fireEvent.click(chips()[0]);
    await waitFor(() => expect(apiMock.run).toHaveBeenCalled());
    expect(apiMock.run.mock.calls.at(-1)?.[2].options).toEqual({});
  });

  it('RF-51. the chip option is not repeated as a dropdown', async () => {
    render(<ReportPage />);
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Show')).toBeNull();
  });

  it('RF-52. four headline cards, with a red warning for Overdue', async () => {
    const { container } = render(<ReportPage />);
    await screen.findByRole('table');

    expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Total Tasks',
      'Completed',
      'Pending',
      'Overdue',
    ]);
    expect(container.querySelector('[data-tone="red"]')).not.toBeNull();
  });

  it('RF-53. status and priority read as the task board shows them', async () => {
    render(<ReportPage />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Completed').getAttribute('data-tone')).toBe('success');
    expect(within(rows[1]).getByText('Pending').getAttribute('data-tone')).toBe('warning');
    expect(within(rows[1]).getByText('High').getAttribute('data-tone')).toBe('danger');
    // No checklist is a dash, not "0/0".
    expect(within(rows[1]).getByText('—')).toBeTruthy();
  });

  it('RF-54a. keeps the chip row off reports that declare none', async () => {
    routeKey = 'queue.tokens';
    apiMock.run.mockImplementation(async () => reportResponse());
    render(<ReportPage />);
    await screen.findByRole('table');
    expect(screen.queryByRole('group', { name: 'Filter the log' })).toBeNull();
  });

  it('RF-54. an empty log says so inside the panel, with 0 entries', async () => {
    apiMock.run.mockImplementation(async () =>
      tasksLogResponse({ rows: [], meta: { total: 0, limit: 50, offset: 0 } }),
    );
    render(<ReportPage />);

    expect(await screen.findByText('No data found')).toBeTruthy();
    expect(screen.getByText('Task Log')).toBeTruthy();
    expect(screen.getByText('0 entries')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search task…')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EOD REPORTS — a transposed log, and its compliance beneath it
// ═══════════════════════════════════════════════════════════════════════════

function eodLogResponse(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return reportResponse({
    key: 'tasks.eod',
    name: 'EOD Reports',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'field', label: 'Field', type: 'string' },
      { key: 'c0', label: '18 Sep', type: 'string' },
      { key: 'c1', label: '19 Sep', type: 'string' },
    ],
    rows: [
      { field: 'Submitted', c0: '18 Sep, 11:48 PM', c1: '20 Sep, 12:26 AM' },
      { field: 'Review for the day', c0: 'REVIEWS 10\n5*_8\n4*_2', c1: '20reviews' },
      { field: 'Food Complaint', c0: 'NIL', c1: 'B4 small piece of plastic found' },
    ],
    metrics: [
      { key: 'total_reports', label: 'Total Reports', value: 2, type: 'number' },
      { key: 'with_complaints', label: 'With Complaints', value: 1, type: 'number' },
      { key: 'food_complaints', label: 'Food Complaints', value: 1, type: 'number' },
      { key: 'service_issues', label: 'Service Issues', value: 0, type: 'number' },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
    ...overrides,
  });
}

function eodComplianceResponse(compliance = 100): ReportResponse {
  return reportResponse({
    key: 'tasks.eod_compliance',
    name: 'EOD Submission Compliance',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'staff', label: 'Staff', type: 'string' },
      { key: 'submitted', label: 'Submitted', type: 'string' },
      { key: 'compliance', label: 'Compliance', type: 'percent' },
      { key: 'missed_dates', label: 'Missed Dates', type: 'string' },
    ],
    rows: [{ staff: 'annanagarrm', submitted: '7 of 7', compliance, missed_dates: null }],
    metrics: [
      { key: 'compliance', label: 'Compliance', value: compliance, type: 'percent' },
      { key: 'submitted', label: 'Submitted', value: '7 of 7', type: 'string' },
      { key: 'missed', label: 'Missed', value: 0, type: 'number' },
      { key: 'pending', label: 'Pending', value: 1, type: 'number' },
      { key: 'staff_count', label: 'Staff', value: 1, type: 'number' },
      { key: 'due_days', label: 'Days due', value: 7, type: 'number' },
    ],
    meta: { total: 1, limit: 50, offset: 0 },
  });
}

describe('tasks.eod report screen', () => {
  beforeEach(() => {
    routeKey = 'tasks.eod';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.eod_compliance' ? eodComplianceResponse() : eodLogResponse(),
    );
  });

  it('RF-55. shows the log and its compliance on one screen, each with its own four cards', async () => {
    const { container } = render(<ReportPage />);
    await screen.findByText('Submission Compliance');

    expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Total Reports',
      'With Complaints',
      'Food Complaints',
      'Service Issues',
      // staff_count and due_days feed the badge, not cards of their own.
      'Compliance',
      'Submitted',
      'Missed',
      'Pending',
    ]);
    expect(screen.getByText('EOD Log (Transposed)')).toBeTruthy();
    expect(screen.getByText('2 entries')).toBeTruthy();
    expect(screen.getByText('1 staff · 7 days')).toBeTruthy();
    expect(screen.getByText('7 of 7', { selector: 'dd' })).toBeTruthy();
  });

  it('RF-56. runs the compliance over the SAME dates, and Run refreshes both', async () => {
    render(<ReportPage />);
    await screen.findByText('Submission Compliance');

    const keys = () => apiMock.run.mock.calls.map((c) => c[1]);
    expect(keys()).toContain('tasks.eod');
    expect(keys()).toContain('tasks.eod_compliance');

    apiMock.run.mockClear();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-16' } });
    await waitFor(() => expect(keys()).toEqual(expect.arrayContaining(['tasks.eod', 'tasks.eod_compliance'])));
    const byKey = (k: string) => apiMock.run.mock.calls.filter((c) => c[1] === k).at(-1)?.[2];
    expect(byKey('tasks.eod_compliance')).toMatchObject({ from: '2026-09-16' });
    expect(byKey('tasks.eod')).toMatchObject({ from: '2026-09-16' });
  });

  it('RF-57. the transposed log: dates across the top, the field names down the side, text kept as written', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];

    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Field',
      '18 Sep',
      '19 Sep',
    ]);
    const firstCells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelector('td')?.textContent);
    expect(firstCells).toEqual(['Submitted', 'Review for the day', 'Food Complaint']);
    // The writer's own line breaks survive.
    expect(within(table).getByText(/REVIEWS 10\s+5\*_8\s+4\*_2/).textContent).toContain('\n');
  });

  it('RF-58. no search box on the EOD screen', async () => {
    render(<ReportPage />);
    await screen.findByText('Submission Compliance');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('RF-59. colours the compliance rate: full is green, poor is red', async () => {
    const { unmount } = render(<ReportPage />);
    const tables = await screen.findAllByRole('table');
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    const compliance = within(screen.getAllByRole('table')[1]).getByText('100%');
    expect(compliance.getAttribute('data-tone')).toBe('success');
    expect(tables.length).toBeGreaterThan(0);
    unmount();

    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.eod_compliance' ? eodComplianceResponse(40) : eodLogResponse(),
    );
    render(<ReportPage />);
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    expect(within(screen.getAllByRole('table')[1]).getByText('40%').getAttribute('data-tone')).toBe('danger');
  });

  it('RF-60. a compliance failure is reported without losing the log above it', async () => {
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) => {
      if (key === 'tasks.eod_compliance') throw new Error('Compliance is unavailable');
      return eodLogResponse();
    });
    render(<ReportPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Compliance is unavailable');
    expect(screen.getByText('EOD Log (Transposed)')).toBeTruthy();
    expect(screen.queryByText('Submission Compliance')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OPERATIONAL CHECKLIST — the same two-part screen, with average ratings
// ═══════════════════════════════════════════════════════════════════════════

function operationalLogResponse(submitted: boolean): ReportResponse {
  return reportResponse({
    key: 'tasks.operational',
    name: 'Operational Checklist',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'field', label: 'Field', type: 'string' },
      ...(submitted ? [{ key: 'c0', label: '18 Sep', type: 'string' as const }] : []),
    ],
    rows: submitted
      ? [
          { field: 'Submitted', c0: '18 Sep, 11:02 AM' },
          { field: 'Overall Rating for security (scale 1-5)', c0: '4/5' },
        ]
      : [],
    metrics: [
      { key: 'total_checklists', label: 'Total Checklists', value: submitted ? 1 : 0, type: 'number' },
      { key: 'avg_security', label: 'Avg Security', value: submitted ? 4 : 0, type: 'number' },
      { key: 'avg_readiness', label: 'Avg Readiness', value: submitted ? 4.5 : 0, type: 'number' },
      { key: 'avg_operation', label: 'Avg Operation', value: submitted ? 3 : 0, type: 'number' },
    ],
    meta: { total: submitted ? 1 : 0, limit: 50, offset: 0 },
  });
}

function operationalComplianceEmpty(): ReportResponse {
  return reportResponse({
    key: 'tasks.operational_compliance',
    name: 'Operational Checklist Submission Compliance',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'staff', label: 'Staff', type: 'string' },
      { key: 'compliance', label: 'Compliance', type: 'percent' },
    ],
    rows: [],
    metrics: [
      { key: 'compliance', label: 'Compliance', value: null, type: 'percent' },
      { key: 'submitted', label: 'Submitted', value: null, type: 'string' },
      { key: 'missed', label: 'Missed', value: 0, type: 'number' },
      { key: 'pending', label: 'Pending', value: 0, type: 'number' },
      { key: 'staff_count', label: 'Staff', value: 0, type: 'number' },
      { key: 'due_days', label: 'Days due', value: 7, type: 'number' },
    ],
    meta: { total: 0, limit: 50, offset: 0 },
  });
}

describe('tasks.operational report screen', () => {
  const mount = (submitted: boolean) => {
    routeKey = 'tasks.operational';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.operational_compliance' ? operationalComplianceEmpty() : operationalLogResponse(submitted),
    );
    return render(<ReportPage />);
  };

  it('RF-61. an empty week reads as the reference does: zero averages, dashes for compliance, and why it is empty', async () => {
    const { container } = mount(false);
    await screen.findByText('Submission Compliance');

    const cards = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.parentElement?.querySelector('dd')?.textContent,
    ]);
    expect(cards).toEqual([
      ['Total Checklists', '0'],
      ['Avg Security', '0'],
      ['Avg Readiness', '0'],
      ['Avg Operation', '0'],
      ['Compliance', '—'],
      ['Submitted', '—'],
      ['Missed', '0'],
      ['Pending', '0'],
    ]);
    expect(screen.getByText('Checklist Log (Transposed)')).toBeTruthy();
    expect(screen.getByText('0 entries')).toBeTruthy();
    expect(screen.getByText('No data found')).toBeTruthy();
    expect(screen.getByText('0 staff · 7 days')).toBeTruthy();
    expect(screen.getByText('No Operational Checklist was scheduled for anyone in this period')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('RF-62. a filed checklist: the transposed log with its rating, and its averages to one decimal', async () => {
    mount(true);
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Field', '18 Sep']);
    expect(within(table).getByText('4/5')).toBeTruthy();
    expect(screen.getByText('4.5', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('1 entry')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KITCHEN CHECKLIST — a row per submission, and its compliance beneath it
// ═══════════════════════════════════════════════════════════════════════════

function kitchenLogResponse(): ReportResponse {
  return reportResponse({
    key: 'tasks.kitchen',
    name: 'Kitchen Checklist',
    kind: 'summary',
    option_specs: [],
    drilldown: { id_key: 'task_id', path: '/tasks/:id' },
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'hygiene', label: 'Hygiene', type: 'string' },
      { key: 'fifo', label: 'FIFO', type: 'string' },
      { key: 'images', label: 'Images', type: 'string' },
    ],
    rows: [
      {
        task_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        date: '23 Sep',
        submitted_by: 'velacherykitchen',
        submitted_at: '23 Sep, 11:52 AM',
        branch_name: 'Velachery',
        hygiene: 'yes',
        fifo: 'N/A',
        images: '21 imgs',
      },
    ],
    metrics: [
      { key: 'total_checklists', label: 'Total Checklists', value: 36, type: 'number' },
      { key: 'with_images', label: 'With Images', value: 36, type: 'number' },
      { key: 'hygiene_issues', label: 'Hygiene Issues', value: 0, type: 'number' },
      { key: 'fifo_followed', label: 'FIFO Followed', value: 29, type: 'number' },
    ],
    meta: { total: 36, limit: 50, offset: 0 },
  });
}

function kitchenComplianceResponse(): ReportResponse {
  return reportResponse({
    key: 'tasks.kitchen_compliance',
    name: 'Kitchen Checklist Submission Compliance',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'staff', label: 'Staff', type: 'string' },
      { key: 'submitted', label: 'Submitted', type: 'string' },
      { key: 'missed', label: 'Missed', type: 'number' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'compliance', label: 'Compliance', type: 'percent' },
      { key: 'missed_dates', label: 'Missed Dates', type: 'string' },
    ],
    rows: [
      {
        staff: 'alwarpetba',
        submitted: '0 of 7',
        missed: 7,
        pending: 1,
        compliance: 0,
        missed_dates: '16 Sep, 17 Sep, 18 Sep, 19 Sep +3 more',
      },
      { staff: 'annanagarkitchen', submitted: '7 of 7', missed: 0, pending: 0, compliance: 100, missed_dates: null },
    ],
    metrics: [
      { key: 'compliance', label: 'Compliance', value: 30, type: 'percent' },
      { key: 'submitted', label: 'Submitted', value: '32 of 105', type: 'string' },
      { key: 'missed', label: 'Missed', value: 73, type: 'number' },
      { key: 'pending', label: 'Pending (4 filed)', value: 11, type: 'number' },
      { key: 'filed_today', label: 'Filed today', value: 4, type: 'number' },
      { key: 'staff_count', label: 'Staff', value: 15, type: 'number' },
      { key: 'due_days', label: 'Days due', value: 7, type: 'number' },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
  });
}

describe('tasks.kitchen report screen', () => {
  beforeEach(() => {
    routeKey = 'tasks.kitchen';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.kitchen_compliance' ? kitchenComplianceResponse() : kitchenLogResponse(),
    );
  });

  it("RF-63. the log and its compliance, each with its four cards; today's filings named on Pending", async () => {
    const { container } = render(<ReportPage />);
    await screen.findByText('Submission Compliance');

    const cards = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.parentElement?.querySelector('dd')?.textContent,
    ]);
    expect(cards).toEqual([
      ['Total Checklists', '36'],
      ['With Images', '36'],
      ['Hygiene Issues', '0'],
      ['FIFO Followed', '29'],
      ['Compliance', '30%'],
      ['Submitted', '32 of 105'],
      ['Missed', '73'],
      ['Pending (4 filed)', '11'],
    ]);
    expect(screen.getByText('Kitchen Log')).toBeTruthy();
    expect(screen.getByText('36 entries')).toBeTruthy();
    expect(screen.getByText('15 staff · 7 days')).toBeTruthy();
  });

  it('RF-64. one row per submission; its date opens the task', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date',
      'Submitted By',
      'Submitted At',
      'Branch',
      'Hygiene',
      'FIFO',
      'Images',
    ]);
    const link = within(table).getByRole('link', { name: '23 Sep' });
    expect(link.getAttribute('href')).toBe('/tasks/aaaaaaaa-0000-4000-8000-000000000001');
    expect(within(table).getByText('21 imgs')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('RF-65. compliance rows: missed counts and dates in red, only when there are any', async () => {
    render(<ReportPage />);
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    const table = screen.getAllByRole('table')[1];
    expect(within(table).getByText('7').getAttribute('data-tone')).toBe('danger');
    expect(within(table).getByText('16 Sep, 17 Sep, 18 Sep, 19 Sep +3 more').getAttribute('data-tone')).toBe(
      'danger',
    );
    // Nothing missed: plain text, no colour.
    const second = within(table).getAllByRole('row')[2];
    expect(second.querySelectorAll('[data-tone="danger"]')).toHaveLength(0);
    expect(within(table).getByText('0%').getAttribute('data-tone')).toBe('danger');
  });
});

describe('compliance card icon', () => {
  it('RF-66. takes the rate’s colour, and stays blue while nothing was due', async () => {
    const { complianceMetricIcons } = await import('@/lib/reports/eod-ui');
    const tone = (value: number | null) =>
      complianceMetricIcons([{ key: 'compliance', label: 'Compliance', value, type: 'percent' }]).compliance.tone;
    expect(tone(30)).toBe('red');
    expect(tone(75)).toBe('amber');
    expect(tone(100)).toBe('green');
    expect(tone(null)).toBe('blue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BRANCH HEAD OPENING — a searchable log whose rows open in full
// ═══════════════════════════════════════════════════════════════════════════

function openingLogResponse(): ReportResponse {
  return reportResponse({
    key: 'tasks.opening',
    name: 'Branch Head Opening',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'cctv', label: 'CCTV', type: 'string' },
      { key: 'remarks', label: 'Remarks', type: 'string' },
    ],
    rows: [
      {
        task_id: 'bbbbbbbb-0000-4000-8000-000000000001',
        date: '23 Sep 2026',
        submitted_at: '23 Sep, 11:26 AM',
        submitted_by: 'pallavaramba',
        branch_name: 'Pallavaram',
        cctv: 'yes',
        remarks: 'N/A',
      },
      {
        task_id: 'bbbbbbbb-0000-4000-8000-000000000002',
        date: '22 Sep 2026',
        submitted_at: '22 Sep, 10:56 AM',
        submitted_by: 'mogappairba',
        branch_name: 'Pallavaram',
        cctv: '1 is not working',
        remarks: 'restaurant ready',
      },
    ],
    metrics: [
      { key: 'total_reports', label: 'Total Reports', value: 38, type: 'number' },
      { key: 'branches', label: 'Branches', value: 1, type: 'number' },
      { key: 'date_range', label: 'Date Range', value: '8d', type: 'string' },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
  });
}

function openingComplianceResponse(): ReportResponse {
  return reportResponse({
    key: 'tasks.opening_compliance',
    name: 'Branch Head Opening Submission Compliance',
    kind: 'summary',
    option_specs: [],
    columns: [
      { key: 'staff', label: 'Staff', type: 'string' },
      { key: 'missed', label: 'Missed', type: 'number' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'compliance', label: 'Compliance', type: 'percent' },
    ],
    rows: [
      { staff: 'teynampetba', missed: 6, pending: 0, compliance: 14, filed_today: 1 },
      { staff: 'metheakash12', missed: 7, pending: 1, compliance: 0, filed_today: 0 },
    ],
    metrics: [
      { key: 'compliance', label: 'Compliance', value: 51, type: 'percent' },
      { key: 'submitted', label: 'Submitted', value: '32 of 63', type: 'string' },
      { key: 'missed', label: 'Missed', value: 31, type: 'number' },
      { key: 'pending', label: 'Pending (6 filed)', value: 3, type: 'number' },
      { key: 'filed_today', label: 'Filed today', value: 6, type: 'number' },
      { key: 'staff_count', label: 'Staff', value: 9, type: 'number' },
      { key: 'due_days', label: 'Days due', value: 7, type: 'number' },
    ],
    meta: { total: 2, limit: 50, offset: 0 },
  });
}

describe('tasks.opening report screen', () => {
  beforeEach(() => {
    routeKey = 'tasks.opening';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.opening_compliance' ? openingComplianceResponse() : openingLogResponse(),
    );
    tasksApiMock.get.mockReset();
    tasksApiMock.get.mockResolvedValue({
      checklist: [
        {
          id: 'i1',
          label: 'Security present as per roster?',
          position: 0,
          kind: 'TEXT',
          is_required: false,
          is_done: true,
          value: 'yes',
          section: 'Parking & Security',
          max_photos: null,
          done_at: null,
          done_by: null,
        },
      ],
    });
  });

  it('RF-67. three cards, a searchable log with a View button per row', async () => {
    const { container } = render(<ReportPage />);
    await screen.findByText('Submission Compliance');

    const cards = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.parentElement?.querySelector('dd')?.textContent,
    ]);
    expect(cards.slice(0, 3)).toEqual([
      ['Total Reports', '38'],
      ['Branches', '1'],
      ['Date Range', '8d'],
    ]);
    expect(screen.getByText('Checklist Log')).toBeTruthy();
    const table = screen.getAllByRole('table')[0];
    expect(within(table).getAllByRole('columnheader').at(-1)?.textContent).toBe('Details');
    expect(within(table).getAllByRole('button', { name: /^View / })).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'restaurant ready' } });
    expect(within(table).getAllByRole('button', { name: /^View / })).toHaveLength(1);
    expect(within(table).getByRole('button', { name: 'View 22 Sep 2026' })).toBeTruthy();
  });

  it('RF-68. View opens that submission, read from its task, and Escape closes it', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    fireEvent.click(within(table).getByRole('button', { name: 'View 23 Sep 2026' }));

    const dialog = screen.getByRole('dialog', { name: 'Branch Head Opening Details' });
    expect(within(dialog).getByText('23 Sep 2026 - pallavaramba')).toBeTruthy();
    expect(await within(dialog).findByText('Parking & Security')).toBeTruthy();
    expect(within(dialog).getByText('Security present as per roster?')).toBeTruthy();
    expect(tasksApiMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: expect.any(String) }),
      'bbbbbbbb-0000-4000-8000-000000000001',
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('RF-69. compliance: "+1 filed" beside Pending for whoever filed today, and worst first as sent', async () => {
    render(<ReportPage />);
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    const table = screen.getAllByRole('table')[1];
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('+1 filed').closest('[data-tone]')?.getAttribute('data-tone')).toBe('success');
    expect(within(rows[1]).queryByText(/filed/)).toBeNull();
    expect(screen.getByText('Pending (6 filed)')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BANQUET OPENING — the Branch Head Opening layout, over the banquet halls
// ═══════════════════════════════════════════════════════════════════════════

describe('tasks.banquet_opening report screen', () => {
  const REMARK = 'Mirage hall mens washroom leakage to be fixed before the evening party';

  beforeEach(() => {
    routeKey = 'tasks.banquet_opening';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.banquet_opening_compliance'
        ? { ...openingComplianceResponse(), key }
        : reportResponse({
            key: 'tasks.banquet_opening',
            name: 'Banquet Opening',
            kind: 'summary',
            option_specs: [],
            columns: [
              { key: 'date', label: 'Date', type: 'string' },
              { key: 'submitted_by', label: 'Submitted By', type: 'string' },
              { key: 'party_bookings', label: 'Party Bookings', type: 'string' },
              { key: 'tvs', label: 'TVs', type: 'string' },
              { key: 'remarks', label: 'Remarks', type: 'string' },
            ],
            rows: [
              {
                task_id: 'cccccccc-0000-4000-8000-000000000001',
                date: '23 Sep 2026',
                submitted_by: 'pallavarambqt',
                party_bookings: 'No party',
                tvs: 'No',
                remarks: REMARK,
              },
            ],
            metrics: [
              { key: 'total_reports', label: 'Total Reports', value: 30, type: 'number' },
              { key: 'branches', label: 'Branches', value: 1, type: 'number' },
              { key: 'date_range', label: 'Date Range', value: '8d', type: 'string' },
            ],
            meta: { total: 1, limit: 50, offset: 0 },
          }),
    );
    tasksApiMock.get.mockReset();
    tasksApiMock.get.mockResolvedValue({ checklist: [] });
  });

  it('RF-70. the log: a long remark cut to one line, its full text kept in the title', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    expect(screen.getByText('Checklist Log')).toBeTruthy();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date',
      'Submitted By',
      'Party Bookings',
      'TVs',
      'Remarks',
      'Details',
    ]);
    expect(within(table).getByText(REMARK).getAttribute('title')).toBe(REMARK);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
  });

  it("RF-71. View opens the banquet checklist's own details, in its own colour", async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    fireEvent.click(within(table).getByRole('button', { name: 'View 23 Sep 2026' }));
    const dialog = screen.getByRole('dialog', { name: 'Banquet Opening Checklist Details' });
    expect(dialog.getAttribute('data-tone')).toBe('red');
    expect(within(dialog).getByText('23 Sep 2026 - pallavarambqt')).toBeTruthy();
    expect(tasksApiMock.get).toHaveBeenCalledWith(expect.anything(), 'cccccccc-0000-4000-8000-000000000001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BM CHECKLIST — scores and yes/no as pills, averaged on the cards
// ═══════════════════════════════════════════════════════════════════════════

describe('tasks.bm report screen', () => {
  beforeEach(() => {
    routeKey = 'tasks.bm';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.bm_compliance'
        ? { ...openingComplianceResponse(), key }
        : reportResponse({
            key: 'tasks.bm',
            name: 'BM Checklist',
            kind: 'summary',
            option_specs: [],
            columns: [
              { key: 'date', label: 'Date', type: 'string' },
              { key: 'manager', label: 'Manager', type: 'string' },
              { key: 'daily_score', label: 'Daily Score', type: 'string' },
              { key: 'briefing_score', label: 'Briefing Score', type: 'string' },
              { key: 'tv_music', label: 'TV/Music', type: 'string' },
              { key: 'equipment', label: 'Equipment', type: 'string' },
              { key: 'remarks', label: 'Remarks', type: 'string' },
            ],
            rows: [
              {
                task_id: 'dddddddd-0000-4000-8000-000000000001',
                date: '23 Sep 2026',
                submitted_by: 'alwarpetrm',
                manager: 'Mr Vasu',
                daily_score: '5/6',
                briefing_score: '2/6',
                tv_music: 'No',
                equipment: 'Yes',
                remarks: 'manageable',
              },
            ],
            metrics: [
              { key: 'total_reports', label: 'Total Reports', value: 47, type: 'number' },
              { key: 'branches', label: 'Branches', value: 1, type: 'number' },
              { key: 'date_range', label: 'Date Range', value: '8d', type: 'string' },
              { key: 'avg_daily', label: 'Avg Daily', value: '5.6/6', type: 'string' },
              { key: 'avg_briefing', label: 'Avg Briefing', value: '5.8/6', type: 'string' },
            ],
            meta: { total: 1, limit: 50, offset: 0 },
          }),
    );
    tasksApiMock.get.mockReset();
    tasksApiMock.get.mockResolvedValue({ checklist: [] });
  });

  it('RF-72. three cards: reports and the two average scores', async () => {
    const { container } = render(<ReportPage />);
    await screen.findByText('Submission Compliance');
    const cards = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.parentElement?.querySelector('dd')?.textContent,
    ]);
    expect(cards.slice(0, 3)).toEqual([
      ['Total Reports', '47'],
      ['Avg Daily', '5.6/6'],
      ['Avg Briefing', '5.8/6'],
    ]);
    expect(screen.getByText('BM Checklist Log')).toBeTruthy();
  });

  it('RF-73. scores and yes/no answers as coloured pills; free text stays plain', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    expect(within(table).getByText('5/6').getAttribute('data-tone')).toBe('success');
    expect(within(table).getByText('2/6').getAttribute('data-tone')).toBe('danger');
    expect(within(table).getByText('No').getAttribute('data-tone')).toBe('danger');
    expect(within(table).getByText('Yes').getAttribute('data-tone')).toBe('success');
    expect(within(table).getByText('Mr Vasu').hasAttribute('data-tone')).toBe(false);
  });

  it("RF-74. View names the submission by its day and manager", async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    fireEvent.click(within(table).getByRole('button', { name: 'View 23 Sep 2026' }));
    const dialog = screen.getByRole('dialog', { name: 'BM Checklist Details' });
    expect(within(dialog).getByText('23 Sep 2026 - Mr Vasu')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KITCHEN BALANCE — each submission totalled, and by section
// ═══════════════════════════════════════════════════════════════════════════

describe('tasks.kitchen_balance report screen', () => {
  beforeEach(() => {
    routeKey = 'tasks.kitchen_balance';
    apiMock.run.mockImplementation(async (_ctx: unknown, key: string) =>
      key === 'tasks.kitchen_balance_compliance'
        ? { ...openingComplianceResponse(), key }
        : reportResponse({
            key: 'tasks.kitchen_balance',
            name: 'Kitchen Balance',
            kind: 'summary',
            option_specs: [],
            columns: [
              { key: 'date', label: 'Date', type: 'string' },
              { key: 'submitted_by', label: 'Submitted By', type: 'string' },
              { key: 'branch_name', label: 'Branch', type: 'string' },
              { key: 'total', label: 'Total', type: 'number' },
              { key: 'biryani', label: 'Biryani', type: 'number' },
              { key: 'breads', label: 'Breads', type: 'number' },
              { key: 'submitted_at', label: 'Submitted At', type: 'string' },
            ],
            rows: [
              {
                task_id: 'eeeeeeee-0000-4000-8000-000000000001',
                date: '24 Sep 2026',
                submitted_by: 'alwarpetba',
                branch_name: 'Alwarpet',
                total: 103,
                biryani: 9,
                breads: 42,
                submitted_at: '24 Sep, 11:53 AM',
              },
              {
                task_id: 'eeeeeeee-0000-4000-8000-000000000002',
                date: '22 Sep 2026',
                submitted_by: 'teynampetkitchen',
                branch_name: 'Alwarpet',
                total: 98,
                biryani: 3,
                breads: 22,
                submitted_at: '23 Sep, 12:28 AM',
              },
            ],
            metrics: [
              { key: 'total_reports', label: 'Total Reports', value: 17, type: 'number' },
              { key: 'total_items', label: 'Total Items', value: 1575, type: 'number' },
              { key: 'avg_items', label: 'Avg Items', value: 93, type: 'number' },
            ],
            meta: { total: 2, limit: 50, offset: 0 },
          }),
    );
  });

  it('RF-75. three cards and a Balance Log with each total in bold', async () => {
    const { container } = render(<ReportPage />);
    await screen.findByText('Submission Compliance');
    const cards = [...container.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.parentElement?.querySelector('dd')?.textContent,
    ]);
    expect(cards.slice(0, 3)).toEqual([
      ['Total Reports', '17'],
      ['Total Items', '1,575'],
      ['Avg Items', '93'],
    ]);
    expect(screen.getByText('Balance Log')).toBeTruthy();

    const table = screen.getAllByRole('table')[0];
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Date',
      'Submitted By',
      'Branch',
      'Total',
      'Biryani',
      'Breads',
      'Submitted At',
    ]);
    // Only the total is bold; no View column on this screen.
    const total = within(table).getByText('103');
    const biryani = within(table).getByText('9');
    expect(total.className).not.toBe(biryani.className);
    expect(within(table).queryByRole('button', { name: /^View / })).toBeNull();
  });

  it('RF-76. search narrows the log by who filed it', async () => {
    render(<ReportPage />);
    const table = (await screen.findAllByRole('table'))[0];
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'teynampet' } });
    expect(within(table).queryByText('103')).toBeNull();
    expect(within(table).getByText('98')).toBeTruthy();
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

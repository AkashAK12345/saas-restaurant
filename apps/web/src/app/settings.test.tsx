import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  auditLogs: vi.fn(),
  branches: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  updateCompany: vi.fn(),
  sessions: vi.fn(),
  revokeSession: vi.fn(),
}));
const reloadMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/settings/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/settings/api')>('@/lib/settings/api');
  return {
    ...actual,
    settingsApi: new Proxy(apiMock, {
      get: (t, k: string) => (...a: unknown[]) => (t as Record<string, (...x: unknown[]) => unknown>)[k](...a),
    }),
  };
});

let companyPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    selectedBranch: { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    companyPermissions,
    branchPermissions: [],
    companies: [{ id: 'co-1', name: 'Alpha Corp', status: 'ACTIVE' }],
    reload: reloadMock,
    loading: false,
  }),
}));

import DevicesPage from './(staff)/(app)/settings/devices/page';
import BranchesPage from './(staff)/(app)/settings/branches/page';
import AuditPage from './(staff)/(app)/settings/audit/page';
import { describeDevice } from '@/lib/settings/api';

const session = (over: Record<string, unknown> = {}) => ({
  handle: 'a'.repeat(32),
  created_at: '2026-09-14T04:30:00.000Z',
  last_used_at: '2026-09-15T04:30:00.000Z',
  expires_at: '2026-09-22T04:30:00.000Z',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130',
  ip_address: '10.0.0.8',
  current: false,
  ...over,
});

describe('Signed-in devices', () => {
  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
  });

  it('names devices plainly', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile')).toBe('Chrome on Android');
    expect(describeDevice(null)).toBe('Unknown device');
  });

  it('lists the caller’s logins, marks this device, and offers sign-out only for the others', async () => {
    apiMock.sessions.mockResolvedValue({
      data: [
        session({ handle: 'c'.repeat(32), current: true, user_agent: 'Mozilla/5.0 (Macintosh; Mac OS X) Safari/605' }),
        session(),
      ],
    });
    apiMock.revokeSession.mockResolvedValue({ revoked: true, current: false });
    render(<DevicesPage />);

    expect(await screen.findByText('This device')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Sign out/ })).toHaveLength(1);
    // Times are the branch's clock, dd/MM/yyyy.
    expect(screen.getAllByText(/Last active 15\/09\/2026, 10:00\s?am/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out Chrome on Windows' }));
    await waitFor(() => expect(apiMock.revokeSession).toHaveBeenCalledWith('a'.repeat(32)));
    expect(await screen.findByText('Signed out Chrome on Windows.')).toBeTruthy();
    expect(apiMock.sessions).toHaveBeenCalledTimes(2);
  });

  it('says why the list could not load instead of showing an empty page', async () => {
    apiMock.sessions.mockRejectedValue(new Error('Network unreachable'));
    render(<DevicesPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('Network unreachable');
  });
});

describe('Branch tax settings', () => {
  const branch = {
    id: 'br-1',
    company_id: 'co-1',
    name: 'Alpha Main',
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE' as const,
    gstin: null,
    fssai_license: null,
    banquet_gst_rate_bps: 0,
    banquet_terms: null,
  };

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    companyPermissions = ['branches.view', 'branches.update'];
    apiMock.branches.mockResolvedValue([branch]);
    apiMock.updateBranch.mockResolvedValue({ ...branch });
  });

  it('shows the current settings and saves a GSTIN, FSSAI licence and GST slab', async () => {
    render(<BranchesPage />);
    expect(await screen.findByText(/GSTIN: Not set · FSSAI: Not set · Banquet GST: No GST/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit tax details for Alpha Main' }));
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '27aapfu0939f1zv' } });
    fireEvent.change(screen.getByLabelText('FSSAI licence number'), { target: { value: '11521999000123' } });
    fireEvent.change(screen.getByLabelText('GST on new banquet bookings'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiMock.updateBranch).toHaveBeenCalledWith('co-1', 'br-1', {
        gstin: '27AAPFU0939F1ZV',
        fssai_license: '11521999000123',
        banquet_gst_rate_bps: 500,
        banquet_terms: null,
      }),
    );
  });

  it('saves the bill terms trimmed, and counts them against the limit', async () => {
    render(<BranchesPage />);
    expect(await screen.findByText(/Bill terms: Not set/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tax details for Alpha Main' }));
    const terms = screen.getByLabelText('Terms and conditions on banquet bills') as HTMLTextAreaElement;
    expect(terms.maxLength).toBe(4000);
    fireEvent.change(terms, { target: { value: '  Advance is non-refundable.\nMusic stops at 23:00.  ' } });
    expect(screen.getByText(/52 of 4000 characters/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock.updateBranch).toHaveBeenCalledWith(
        'co-1',
        'br-1',
        expect.objectContaining({ banquet_terms: 'Advance is non-refundable.\nMusic stops at 23:00.' }),
      ),
    );
  });

  it('will not save a malformed GSTIN', async () => {
    render(<BranchesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit tax details for Alpha Main' }));
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: 'NOT-A-GSTIN' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/15 characters/)).toBeTruthy();
  });

  it('offers no editing without branches.update, and nothing at all without branches.view', async () => {
    companyPermissions = ['branches.view'];
    const { unmount } = render(<BranchesPage />);
    await screen.findByText(/Banquet GST/);
    expect(screen.queryByRole('button', { name: /Edit tax details/ })).toBeNull();
    unmount();

    companyPermissions = [];
    render(<BranchesPage />);
    expect(screen.getByText(/do not have access/)).toBeTruthy();
    expect(apiMock.branches).toHaveBeenCalledTimes(1);
  });
});

describe('Company and branch management', () => {
  const branch = {
    id: 'br-1',
    company_id: 'co-1',
    name: 'Alpha Main',
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE' as const,
    gstin: null,
    fssai_license: null,
    banquet_gst_rate_bps: 0,
    banquet_terms: null,
  };

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    reloadMock.mockClear();
    companyPermissions = ['branches.view', 'branches.create', 'branches.update', 'companies.update'];
    apiMock.branches.mockResolvedValue([branch]);
    apiMock.updateBranch.mockResolvedValue({ ...branch });
    apiMock.createBranch.mockResolvedValue({ ...branch, id: 'br-2', name: 'Alpha Two' });
    apiMock.updateCompany.mockResolvedValue({ id: 'co-1', name: 'Alpha Foods', status: 'ACTIVE' });
  });

  it('adds a branch with a name and a real time zone, then refreshes the shell', async () => {
    render(<BranchesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add branch' }));
    const form = screen.getByRole('form', { name: 'New branch' });
    fireEvent.change(within(form).getByLabelText('New branch name'), { target: { value: '  Alpha Two ' } });
    const zone = within(form).getByLabelText('Time zone') as HTMLSelectElement;
    expect(zone.value).toBe('Asia/Kolkata');
    expect([...zone.options].some((o) => o.value === 'Europe/London')).toBe(true);
    fireEvent.change(zone, { target: { value: 'Europe/London' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiMock.createBranch).toHaveBeenCalledWith('co-1', { name: 'Alpha Two', timezone: 'Europe/London' }));
    expect(await screen.findByText('Added branch Alpha Two.')).toBeTruthy();
    expect(reloadMock).toHaveBeenCalled();
  });

  it('renames a branch, sending the name only because it changed', async () => {
    render(<BranchesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit tax details for Alpha Main' }));
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'Alpha Central' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiMock.updateBranch).toHaveBeenCalledWith('co-1', 'br-1', expect.objectContaining({ name: 'Alpha Central' })),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit tax details for Alpha Main' }));
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deactivates a branch only after a confirmation', async () => {
    render(<BranchesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Alpha Main' }));
    expect(apiMock.updateBranch).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Confirm status change for Alpha Main' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, deactivate' }));
    await waitFor(() => expect(apiMock.updateBranch).toHaveBeenCalledWith('co-1', 'br-1', { status: 'INACTIVE' }));
    expect(await screen.findByText('Alpha Main is now inactive.')).toBeTruthy();
  });

  it('renames the company, and shows a refusal from the server', async () => {
    apiMock.updateCompany.mockRejectedValueOnce(new Error('Forbidden'));
    render(<BranchesPage />);
    const company = await screen.findByRole('region', { name: 'Company' });
    expect(company.textContent).toMatch('Alpha Corp');
    fireEvent.click(within(company).getByRole('button', { name: 'Rename company' }));
    fireEvent.change(within(company).getByLabelText('Company name'), { target: { value: 'Alpha Foods' } });
    fireEvent.click(within(company).getByRole('button', { name: 'Save name' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('Forbidden');

    fireEvent.click(within(company).getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(apiMock.updateCompany).toHaveBeenLastCalledWith('co-1', { name: 'Alpha Foods' }));
    expect(await screen.findByText('Company renamed to Alpha Foods.')).toBeTruthy();
  });

  it('offers no add, rename or status control without the matching permission', async () => {
    companyPermissions = ['branches.view'];
    render(<BranchesPage />);
    await screen.findByText('Alpha Main');
    expect(screen.queryByRole('button', { name: 'Add branch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename company' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Deactivate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit tax details/ })).toBeNull();
  });
});

describe('Audit log', () => {
  const entry = {
    id: 'a-1',
    created_at: '2026-09-15T04:30:00.000Z',
    event_type: 'CREATE' as const,
    entity_type: 'BANQUET_BOOKING_ADJUSTMENT',
    entity_id: 'x',
    payload: { action: 'add_adjustment', changes: { total_amount_minor: { from: 12900000, to: 12000000 } } },
    user: { id: 'u-1', email: 'manager@samco.test', first_name: 'Asha', last_name: 'Rao' },
    branch: { id: 'br-1', name: 'Alpha Main' },
  };

  beforeEach(() => {
    for (const fn of Object.values(apiMock)) fn.mockReset();
    companyPermissions = ['audit_logs.view'];
    apiMock.auditLogs.mockResolvedValue({ data: [entry], meta: { total: 120, limit: 50, offset: 0 } });
  });

  it('shows who did what, where and when — with old and new values', async () => {
    render(<AuditPage />);
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toMatch(/15\/09\/2026, 10:00\s?am/i);
    expect(row.textContent).toMatch('Asha Rao');
    expect(row.textContent).toMatch('Alpha Main');
    expect(row.textContent).toMatch('add adjustment — total amount minor: 12900000 → 12000000');
    expect(screen.getByText('Showing 1–1 of 120')).toBeTruthy();
  });

  it('filters and pages on the server', async () => {
    render(<AuditPage />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Event'), { target: { value: 'SECURITY' } });
    await waitFor(() =>
      expect(apiMock.auditLogs).toHaveBeenLastCalledWith('co-1', expect.objectContaining({ event_type: 'SECURITY', offset: 0 })),
    );

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    await waitFor(() =>
      expect(apiMock.auditLogs).toHaveBeenLastCalledWith(
        'co-1',
        // Midnight in Kolkata is 18:30 UTC the previous day.
        expect.objectContaining({ from: '2026-08-31T18:30:00.000Z' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(apiMock.auditLogs).toHaveBeenLastCalledWith('co-1', expect.objectContaining({ offset: 50 })),
    );
  });

  it('asks for nothing without audit_logs.view', () => {
    companyPermissions = [];
    render(<AuditPage />);
    expect(screen.getByText(/do not have access/)).toBeTruthy();
    expect(apiMock.auditLogs).not.toHaveBeenCalled();
  });
});

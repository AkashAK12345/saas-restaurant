import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const logout = vi.fn();
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'u1', email: 'staff@samco.test' }, login: vi.fn(), logout }),
}));

const ctx = {
  loading: false,
  error: null as string | null,
  companies: [{ id: 'co-A', name: 'Alpha', status: 'ACTIVE' }],
  branches: [{ id: 'br-1', name: 'HQ', status: 'ACTIVE', timezone: 'UTC', has_roles: true }],
  selectedCompanyId: 'co-A',
  selectedBranchId: 'br-1',
  selectedBranch: { id: 'br-1', name: 'HQ', status: 'ACTIVE', timezone: 'UTC', has_roles: true },
  companyPermissions: ['customers.view'],
  branchPermissions: ['tables.view'],
  selectCompany: vi.fn(),
  selectBranch: vi.fn(),
  reload: vi.fn(),
};
vi.mock('@/lib/context/app-context-provider', () => ({ useAppContext: () => ctx }));

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { AppShell, pageTitleFor } from './app-shell';

describe('AppShell', () => {
  beforeEach(() => {
    pathname = '/';
    ctx.branchPermissions = ['tables.view'];
  });

  it('names the page in the top bar and keeps the logo in the side navigation', () => {
    render(<AppShell><p /></AppShell>);
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(pageTitleFor('/')).toBe('Dashboard');
    expect(screen.getByRole('link', { name: 'SAMCO home' }).getAttribute('href')).toBe('/');
    expect(pageTitleFor('/tables')).toBe('Tables');
    expect(pageTitleFor('/settings/users/u-1')).toBe('Users');
    expect(pageTitleFor('/settings/devices')).toBe('Devices');
  });

  it('steps back on the queue screens for someone who may open them — they bring their own header', () => {
    pathname = '/queue/podium';
    ctx.branchPermissions = ['queue.view', 'queue.call'];
    render(<AppShell><p>queue screen</p></AppShell>);
    expect(screen.getByRole('main').textContent).toContain('queue screen');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('keeps the full shell on a queue path for someone without queue access, so the refusal sits in context', () => {
    pathname = '/queue';
    render(<AppShell><p>refused</p></AppShell>);
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(2);
    expect(screen.getByRole('main').textContent).toContain('refused');
  });

  it('renders both navigation variants (side for desktop, bottom for touch) from the union of permissions', () => {
    render(<AppShell><p>content</p></AppShell>);
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2);
    // Company-scoped permission → Customers; branch-scoped → Tables; nothing else.
    expect(screen.getAllByRole('link', { name: 'Customers' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Tables' })).toHaveLength(1);
    // The phone bar carries only the destinations a shift runs on, and ends with Settings.
    expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.getByText('content')).toBeDefined();
  });

  it('names the current branch on the chip, from server-provided context', () => {
    render(<AppShell><p /></AppShell>);
    const chip = screen.getByRole('button', { name: /HQ/ });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(chip.getAttribute('aria-haspopup')).toBe('true');
  });

  it('opens a picker whose options are the ones the server returned', () => {
    render(<AppShell><p /></AppShell>);
    fireEvent.click(screen.getByRole('button', { name: /HQ/ }));
    // The branch list comes from /auth/context, so the chip can only ever
    // offer somewhere this user already holds a role. A single company needs
    // no company select: it would be a list of one.
    expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /UTC/ }));
    expect(ctx.selectBranch).toHaveBeenCalledWith('br-1');
  });

  it('closes the picker on Escape, so it cannot get stuck open on a tablet', () => {
    render(<AppShell><p /></AppShell>);
    const chip = screen.getByRole('button', { name: /HQ/ });
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows context errors with a retry, and a live loading status', () => {
    ctx.error = 'Boom';
    ctx.loading = true;
    render(<AppShell><p /></AppShell>);
    expect(screen.getByRole('alert').textContent).toContain('Boom');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(ctx.reload).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Loading/);
    ctx.error = null;
    ctx.loading = false;
  });

  it('sign out calls the session logout', () => {
    render(<AppShell><p /></AppShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('sends every user to Settings, which is where their own devices now live', () => {
    render(<AppShell><p /></AppShell>);
    expect(screen.getAllByRole('link', { name: 'Settings' })[0].getAttribute('href')).toBe('/settings');
    expect(screen.queryByRole('link', { name: 'Devices' })).toBeNull();
    expect(pageTitleFor('/settings')).toBe('Settings');
  });
});

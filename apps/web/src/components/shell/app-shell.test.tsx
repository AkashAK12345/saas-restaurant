import { describe, it, expect, vi } from 'vitest';
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

import { AppShell } from './app-shell';

describe('AppShell', () => {
  it('renders both navigation variants (side for desktop, bottom for touch) from the union of permissions', () => {
    render(<AppShell><p>content</p></AppShell>);
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs).toHaveLength(2);
    // Company-scoped permission → Customers; branch-scoped → Tables; nothing else.
    expect(screen.getAllByRole('link', { name: 'Customers' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Tables' })).toHaveLength(2);
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

    // Company list and branch list both come from /auth/context, so the chip
    // can only ever offer somewhere this user already has a role.
    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), {
      target: { value: 'co-A' },
    });
    expect(ctx.selectCompany).toHaveBeenCalledWith('co-A');

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
});

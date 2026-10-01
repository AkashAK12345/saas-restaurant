import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Nav, bottomNavItems, visibleNavItems } from './nav';
import { NAV_ITEMS, settingsItems } from './nav-items';

describe('permission-aware navigation', () => {
  it('shows only items whose permission the user effectively holds', () => {
    const items = visibleNavItems(['customers.view', 'users.view'], true);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/customers');
    expect(hrefs).not.toContain('/tables');
    expect(hrefs).not.toContain('/queue');
    // Administrative pages live on the Settings hub, not in the navigation.
    expect(hrefs.some((h) => h.startsWith('/settings/'))).toBe(false);
  });

  it('lists the administrative pages on the Settings hub, still keyed on permissions', () => {
    const hrefs = settingsItems().map((i) => i.href);
    expect(hrefs).toEqual(
      expect.arrayContaining(['/settings/users', '/settings/audit', '/settings/branches']),
    );
    // A user's own signed-in devices need no permission.
    expect(settingsItems().find((i) => i.href === '/settings/devices')?.permissions).toEqual([]);
  });

  it('hides branch-scoped items when no branch is selected, even with the permission', () => {
    const withBranch = visibleNavItems(['tables.view', 'queue.view'], true).map((i) => i.href);
    const noBranch = visibleNavItems(['tables.view', 'queue.view'], false).map((i) => i.href);
    expect(withBranch).toEqual(expect.arrayContaining(['/tables', '/queue']));
    expect(noBranch).not.toContain('/tables');
    expect(noBranch).not.toContain('/queue');
  });

  it('with no permissions only the dashboard remains', () => {
    expect(visibleNavItems([], true).map((i) => i.href)).toEqual(['/']);
  });

  it('keeps the phone bar to the destinations a shift runs on, plus Settings', () => {
    const all = ['customers.view', 'tables.view', 'queue.view', 'banquet.view', 'tasks.view', 'inventory.view', 'reports.view', 'display_devices.view', 'users.view'];
    const bottom = bottomNavItems(all, true).map((i) => i.href);
    expect(bottom).toEqual(['/', '/queue', '/tasks', '/banquet', '/inventory', '/settings']);
    // Everything else stays one tap away in the workspace grid, the Settings
    // sheet (Reports) and the side bar.
    expect(visibleNavItems(all, true).map((i) => i.href)).toEqual(
      expect.arrayContaining(['/customers', '/tables', '/displays', '/reports']),
    );
    expect(bottomNavItems([], true).map((i) => i.href)).toEqual(['/', '/settings']);
  });

  it('is keyed on permission keys only — role names and admin flags grant nothing', () => {
    const hrefs = visibleNavItems(['admin', 'Administrator', 'isAdmin', 'superadmin', 'owner', '*'], true).map(
      (i) => i.href,
    );
    expect(hrefs).toEqual(['/']);
    // No nav item declares a role.
    for (const item of NAV_ITEMS) {
      for (const p of item.permissions) expect(p).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });

  it('renders links for visible items and nothing for hidden ones', () => {
    render(<Nav permissions={['customers.view']} hasBranch={false} variant="side" />);
    expect(screen.getByRole('link', { name: 'Customers' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tables' })).toBeNull();
  });

  it('marks the current route with aria-current', () => {
    // usePathname is mocked to '/'
    render(<Nav permissions={['customers.view']} hasBranch={false} variant="side" />);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('the phone’s Settings sheet', () => {
  const rows = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('link')
      .map((l) => [l.textContent, l.getAttribute('href')]);

  it('opens from the bottom bar with the reference rows in order, then Branches and Devices', () => {
    const all = ['reports.view', 'users.view', 'roles.view', 'audit_logs.view', 'banquet.hall.manage', 'branches.view'];
    render(<Nav permissions={all} hasBranch variant="bottom" />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(settings);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(rows(dialog)).toEqual([
      ['ReportsAnalytics & history', '/reports'],
      ['Users & RolesStaff access', '/settings/users'],
      ['Menu ManagementMenus & pricing', '/settings/menu'],
      ['ProductsProduct catalog', '/settings/products'],
      ['Activity LogsAudit trail', '/settings/audit'],
      ['Banquet SetupHalls & slots', '/banquet/catalog'],
      ['Font SizeAdjust text size', '/settings/font-size'],
      ['VersionApp version number', '/settings/version'],
      ['BranchesBranch details', '/settings/branches'],
      ['DevicesYour signed-in devices', '/settings/devices'],
    ]);
  });

  it('with no branch chosen, keeps the branch-held rows, whose pages ask for a branch', () => {
    render(<Nav permissions={[]} hasBranch={false} variant="bottom" />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const hrefs = rows(screen.getByRole('dialog')).map(([, href]) => href);
    expect(hrefs).toContain('/reports');
    expect(hrefs).toContain('/banquet/catalog');
  });

  it('shows only the rows the viewer may open', () => {
    render(<Nav permissions={['users.view']} hasBranch variant="bottom" />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(rows(screen.getByRole('dialog')).map(([text, href]) => `${text} ${href}`)).toEqual([
      'Users & RolesStaff access /settings/users',
      'Menu ManagementMenus & pricing /settings/menu',
      'ProductsProduct catalog /settings/products',
      'Font SizeAdjust text size /settings/font-size',
      'VersionApp version number /settings/version',
      'DevicesYour signed-in devices /settings/devices',
    ]);
  });

  it('closes on Escape, on the backdrop, and when a row is chosen', () => {
    render(<Nav permissions={[]} hasBranch={false} variant="bottom" />);
    const settings = screen.getByRole('button', { name: 'Settings' });

    fireEvent.click(settings);
    expect(settings.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(settings);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(settings);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Devices/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

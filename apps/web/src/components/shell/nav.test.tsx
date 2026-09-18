import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      expect.arrayContaining(['/settings/users', '/settings/roles', '/settings/audit', '/settings/branches']),
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
    const all = ['customers.view', 'tables.view', 'queue.view', 'banquet.view', 'tasks.view', 'reports.view', 'display_devices.view', 'users.view'];
    const bottom = bottomNavItems(all, true).map((i) => i.href);
    expect(bottom).toEqual(['/', '/queue', '/tasks', '/banquet', '/reports', '/settings']);
    // Everything else stays one tap away in the workspace grid and the side bar.
    expect(visibleNavItems(all, true).map((i) => i.href)).toEqual(
      expect.arrayContaining(['/customers', '/tables', '/displays']),
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
    render(<Nav permissions={['customers.view']} hasBranch={false} variant="bottom" />);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull();
  });
});

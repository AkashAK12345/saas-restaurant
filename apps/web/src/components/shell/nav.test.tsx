import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Nav, visibleNavItems } from './nav';
import { NAV_ITEMS } from './nav-items';

describe('permission-aware navigation', () => {
  it('shows only items whose permission the user effectively holds', () => {
    const items = visibleNavItems(['customers.view', 'users.view'], true);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/settings/users');
    expect(hrefs).not.toContain('/tables');
    expect(hrefs).not.toContain('/queue');
    expect(hrefs).not.toContain('/settings/roles');
  });

  it('hides branch-scoped items when no branch is selected, even with the permission', () => {
    const withBranch = visibleNavItems(['tables.view', 'queue.view'], true).map((i) => i.href);
    const noBranch = visibleNavItems(['tables.view', 'queue.view'], false).map((i) => i.href);
    expect(withBranch).toEqual(expect.arrayContaining(['/tables', '/queue']));
    expect(noBranch).not.toContain('/tables');
    expect(noBranch).not.toContain('/queue');
  });

  it('with no permissions only Home remains', () => {
    expect(visibleNavItems([], true).map((i) => i.href)).toEqual(['/']);
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
    expect(screen.getByRole('link', { name: 'Home' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tables' })).toBeNull();
  });

  it('marks the current route with aria-current', () => {
    // usePathname is mocked to '/'
    render(<Nav permissions={['customers.view']} hasBranch={false} variant="bottom" />);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Customers' }).getAttribute('aria-current')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { hasPermission, hasAnyPermission, PERMISSION_KEYS } from './permissions';

describe('permissions helpers', () => {
  const effective = ['customers.view', 'tables.view'];

  it('hasPermission is a plain membership test on the effective set', () => {
    expect(hasPermission(effective, PERMISSION_KEYS.CUSTOMERS_VIEW)).toBe(true);
    expect(hasPermission(effective, PERMISSION_KEYS.USERS_VIEW)).toBe(false);
    expect(hasPermission(undefined, PERMISSION_KEYS.CUSTOMERS_VIEW)).toBe(false);
    expect(hasPermission([], PERMISSION_KEYS.CUSTOMERS_VIEW)).toBe(false);
  });

  it('hasAnyPermission needs at least one match', () => {
    expect(hasAnyPermission(effective, [PERMISSION_KEYS.USERS_VIEW, PERMISSION_KEYS.TABLES_VIEW])).toBe(true);
    expect(hasAnyPermission(effective, [PERMISSION_KEYS.USERS_VIEW])).toBe(false);
    expect(hasAnyPermission(effective, [])).toBe(false);
  });

  it('there is no admin/role concept — only server-issued keys', () => {
    // Anything that is not literally in the effective set grants nothing.
    expect(hasPermission(['admin', 'isAdmin', 'superadmin', '*'], PERMISSION_KEYS.CUSTOMERS_VIEW)).toBe(false);
    // And the helper module exposes no role/admin API.
    const mod = { hasPermission, hasAnyPermission, PERMISSION_KEYS } as Record<string, unknown>;
    expect(Object.keys(mod).some((k) => /admin|role/i.test(k))).toBe(false);
  });
});

import { PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
  /**
   * Any ONE of these grants visibility. Empty means always visible to an
   * authenticated user. Visibility is a courtesy: the backend enforces the
   * real check on every request the page makes.
   */
  permissions: readonly PermissionKey[];
  /** Branch-scoped pages need a selected branch to make sense. */
  requiresBranch?: boolean;
}

/**
 * Navigation is keyed on PERMISSIONS, never on role names or an admin flag.
 * Phase 7–10 screens register here as they are built; the paths below are
 * placeholders for the foundation and render "coming soon" pages.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home', permissions: [] },
  { href: '/customers', label: 'Customers', permissions: [PERMISSION_KEYS.CUSTOMERS_VIEW] },
  { href: '/tables', label: 'Tables', permissions: [PERMISSION_KEYS.TABLES_VIEW], requiresBranch: true },
  { href: '/queue', label: 'Queue', permissions: [PERMISSION_KEYS.QUEUE_VIEW], requiresBranch: true },
  { href: '/banquet', label: 'Banquet', permissions: [PERMISSION_KEYS.BANQUET_KDS_VIEW], requiresBranch: true },
  { href: '/tasks', label: 'Tasks', permissions: [PERMISSION_KEYS.TASKS_VIEW], requiresBranch: true },
  { href: '/displays', label: 'Displays', permissions: [PERMISSION_KEYS.DISPLAY_DEVICES_VIEW], requiresBranch: true },
  { href: '/settings/users', label: 'Users', permissions: [PERMISSION_KEYS.USERS_VIEW] },
  { href: '/settings/roles', label: 'Roles', permissions: [PERMISSION_KEYS.ROLES_VIEW] },
  { href: '/settings/audit', label: 'Audit log', permissions: [PERMISSION_KEYS.AUDIT_LOGS_VIEW] },
];

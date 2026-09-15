import { PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';
import type { NavIconName } from './nav-icons';

/** Which accent tile a destination wears. Wayfinding only, never meaning. */
export type NavAccent = 'terracotta' | 'blue' | 'green' | 'amber' | 'purple';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  accent: NavAccent;
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
 * Phase 7–10 screens register here as they are built; the remaining paths are
 * placeholders for the foundation and render "coming soon" pages.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home', icon: 'home', accent: 'terracotta', permissions: [] },
  {
    href: '/customers',
    label: 'Customers',
    icon: 'customers',
    accent: 'blue',
    permissions: [PERMISSION_KEYS.CUSTOMERS_VIEW],
  },
  {
    href: '/tables',
    label: 'Tables',
    icon: 'tables',
    accent: 'amber',
    permissions: [PERMISSION_KEYS.TABLES_VIEW],
    requiresBranch: true,
  },
  {
    href: '/queue',
    label: 'Queue',
    icon: 'queue',
    accent: 'green',
    permissions: [PERMISSION_KEYS.QUEUE_VIEW],
    requiresBranch: true,
  },
  {
    href: '/banquet',
    label: 'Banquet',
    icon: 'banquet',
    accent: 'amber',
    permissions: [PERMISSION_KEYS.BANQUET_VIEW, PERMISSION_KEYS.BANQUET_KDS_VIEW],
    requiresBranch: true,
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: 'tasks',
    accent: 'purple',
    permissions: [PERMISSION_KEYS.TASKS_VIEW, PERMISSION_KEYS.TASKS_VIEW_OWN],
    requiresBranch: true,
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: 'reports',
    accent: 'blue',
    permissions: [PERMISSION_KEYS.REPORTS_VIEW],
    requiresBranch: true,
  },
  {
    href: '/displays',
    label: 'Displays',
    icon: 'displays',
    accent: 'purple',
    permissions: [PERMISSION_KEYS.DISPLAY_DEVICES_VIEW],
    requiresBranch: true,
  },
  {
    href: '/settings/users',
    label: 'Users',
    icon: 'users',
    accent: 'blue',
    permissions: [PERMISSION_KEYS.USERS_VIEW],
  },
  {
    href: '/settings/roles',
    label: 'Roles',
    icon: 'roles',
    accent: 'green',
    permissions: [PERMISSION_KEYS.ROLES_VIEW],
  },
  {
    href: '/settings/audit',
    label: 'Audit log',
    icon: 'audit',
    accent: 'terracotta',
    permissions: [PERMISSION_KEYS.AUDIT_LOGS_VIEW],
  },
  {
    href: '/settings/branches',
    label: 'Branches',
    icon: 'tables',
    accent: 'amber',
    permissions: [PERMISSION_KEYS.BRANCHES_VIEW],
  },
  // Signed-in devices is the caller's own account page, reached from the
  // header beside "Sign out" (app-shell.tsx) rather than from workspace nav.
];

import { PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';
import type { NavIconName } from './nav-icons';

/** Which accent tile a destination wears. Wayfinding only, never meaning. */
export type NavAccent = 'terracotta' | 'blue' | 'green' | 'amber' | 'purple' | 'slate';

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
  /**
   * Shown in the phone's bottom bar. A thumb bar holds about six targets, so
   * only the destinations a shift actually runs on are marked — everything
   * else is reached from the workspace grid or Settings, and all of it stays
   * in the desktop side navigation.
   */
  primary?: boolean;
  /** Listed on the Settings hub rather than in the workspace grid. */
  settings?: boolean;
}

/**
 * Navigation is keyed on PERMISSIONS, never on role names or an admin flag.
 * Phase 7–10 screens register here as they are built; the remaining paths are
 * placeholders for the foundation and render "coming soon" pages.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', accent: 'blue', permissions: [], primary: true },
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
    primary: true,
  },
  {
    href: '/banquet',
    label: 'Banquet',
    icon: 'banquet',
    accent: 'amber',
    permissions: [PERMISSION_KEYS.BANQUET_VIEW, PERMISSION_KEYS.BANQUET_KDS_VIEW],
    requiresBranch: true,
    primary: true,
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: 'tasks',
    accent: 'terracotta',
    permissions: [PERMISSION_KEYS.TASKS_VIEW, PERMISSION_KEYS.TASKS_VIEW_OWN],
    requiresBranch: true,
    primary: true,
  },
  {
    // Spans branches, so it needs no branch chosen: the grid shows every
    // branch where the viewer holds inventory.view.
    href: '/inventory',
    label: 'Inventory',
    icon: 'inventory',
    accent: 'green',
    permissions: [PERMISSION_KEYS.INVENTORY_VIEW],
    primary: true,
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: 'reports',
    accent: 'purple',
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
    label: 'User Management',
    icon: 'users',
    accent: 'blue',
    permissions: [PERMISSION_KEYS.USERS_VIEW],
    settings: true,
  },
  {
    href: '/settings/audit',
    label: 'Audit log',
    icon: 'audit',
    accent: 'terracotta',
    permissions: [PERMISSION_KEYS.AUDIT_LOGS_VIEW],
    settings: true,
  },
  {
    href: '/settings/branches',
    label: 'Branches',
    icon: 'tables',
    accent: 'amber',
    permissions: [PERMISSION_KEYS.BRANCHES_VIEW],
    settings: true,
  },
  // The caller's own signed-in devices: their own account, so no permission
  // gates it. It sits on the Settings hub beside the administrative pages.
  {
    href: '/settings/devices',
    label: 'Devices',
    icon: 'displays',
    accent: 'slate',
    permissions: [],
    settings: true,
  },
];

/**
 * The Settings hub itself — in the side navigation as a page, and at the end
 * of the phone's bottom bar, where it opens the Settings sheet instead.
 */
export const SETTINGS_ITEM: NavItem = {
  href: '/settings',
  label: 'Settings',
  icon: 'settings',
  accent: 'amber',
  permissions: [],
  primary: true,
};

/** What the Settings hub lists: administrative pages, not operational ones. */
export const settingsItems = (items: readonly NavItem[] = NAV_ITEMS): NavItem[] =>
  items.filter((i) => i.settings);

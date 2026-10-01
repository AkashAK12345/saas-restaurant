import { hasAnyPermission, PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';
import type { AppIconName } from '@/components/app/icons';

/**
 * The Settings menu — the rows the bottom bar's Settings sheet and the
 * Settings page both list, in the reference design's order.
 *
 * Visibility is a courtesy, as everywhere in the navigation: each page behind
 * a row still asks the API, which enforces the real answer.
 */
export interface SettingsEntry {
  key: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
  href: string;
  /** Any ONE of these shows the row. Empty means every signed-in user. */
  permissions: readonly PermissionKey[];
  /**
   * The permission is held per branch. With no branch chosen it cannot be
   * known yet, so the row shows and its page asks for a branch first.
   */
  branchScoped?: boolean;
  /** Not built yet: the row opens a page saying so. */
  comingSoon?: boolean;
}

export const SETTINGS_MENU: readonly SettingsEntry[] = [
  {
    key: 'reports',
    title: 'Reports',
    subtitle: 'Analytics & history',
    icon: 'barChart',
    href: '/reports',
    permissions: [PERMISSION_KEYS.REPORTS_VIEW],
    branchScoped: true,
  },
  {
    key: 'users',
    title: 'Users & Roles',
    subtitle: 'Staff access',
    icon: 'people',
    href: '/settings/users',
    permissions: [PERMISSION_KEYS.USERS_VIEW],
  },
  {
    key: 'menu',
    title: 'Menu Management',
    subtitle: 'Menus & pricing',
    icon: 'utensils',
    href: '/settings/menu',
    permissions: [],
    comingSoon: true,
  },
  {
    key: 'products',
    title: 'Products',
    subtitle: 'Product catalog',
    icon: 'bag',
    href: '/settings/products',
    permissions: [],
    comingSoon: true,
  },
  {
    key: 'activity',
    title: 'Activity Logs',
    subtitle: 'Audit trail',
    icon: 'history',
    href: '/settings/audit',
    permissions: [PERMISSION_KEYS.AUDIT_LOGS_VIEW],
  },
  {
    key: 'banquet',
    title: 'Banquet Setup',
    subtitle: 'Halls & slots',
    icon: 'gear',
    href: '/banquet/catalog',
    permissions: [PERMISSION_KEYS.BANQUET_HALL_MANAGE, PERMISSION_KEYS.BANQUET_PACKAGE_MANAGE],
    branchScoped: true,
  },
  {
    key: 'font-size',
    title: 'Font Size',
    subtitle: 'Adjust text size',
    icon: 'textSize',
    href: '/settings/font-size',
    permissions: [],
    comingSoon: true,
  },
  {
    key: 'version',
    title: 'Version',
    subtitle: 'App version number',
    icon: 'info',
    href: '/settings/version',
    permissions: [],
    comingSoon: true,
  },
  // Beyond the reference: pages SAMCO already has, kept at the bottom.
  {
    key: 'branches',
    title: 'Branches',
    subtitle: 'Branch details',
    icon: 'building',
    href: '/settings/branches',
    permissions: [PERMISSION_KEYS.BRANCHES_VIEW],
  },
  {
    key: 'devices',
    title: 'Devices',
    subtitle: 'Your signed-in devices',
    icon: 'devices',
    href: '/settings/devices',
    permissions: [],
  },
];

/** The rows this viewer may open, each pointing where they can go. */
export function settingsMenuFor(permissions: readonly string[], hasBranch: boolean): SettingsEntry[] {
  return SETTINGS_MENU.filter((entry) => {
    if (entry.branchScoped && !hasBranch) return true;
    return entry.permissions.length === 0 || hasAnyPermission(permissions, entry.permissions);
  });
}

/** The menu row a placeholder page stands in for. */
export const comingSoonEntry = (href: string): SettingsEntry | undefined =>
  SETTINGS_MENU.find((entry) => entry.comingSoon && entry.href === href);

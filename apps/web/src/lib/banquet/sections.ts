import { hasAnyPermission, type PermissionKey } from '@/lib/auth/permissions';
import type { TabItem } from '@/components/app/screen-tab-bar';

/**
 * The banquet module's screens — one list behind the bottom tab bar, so a
 * section cannot appear in one place and be missing from another.
 *
 * Visibility follows the branch permission each screen's own calls need. It is
 * a courtesy: every page still asks the API, which decides.
 */
export interface BanquetSection extends TabItem {
  /** The full name, for headings and the "opening…" message. */
  title: string;
  permissions: readonly PermissionKey[];
}

export const BANQUET_SECTIONS: readonly BanquetSection[] = [
  {
    key: 'availability',
    href: '/banquet/calendar',
    title: 'Booking',
    tab: 'Booking',
    icon: 'calendar',
    tone: 'amber',
    permissions: ['banquet.view'],
  },
  {
    key: 'finance',
    href: '/banquet/finance',
    title: 'Finance',
    tab: 'Finance',
    icon: 'wallet',
    tone: 'blue',
    permissions: ['banquet.finance.view'],
  },
  {
    key: 'kitchen',
    href: '/banquet/kitchen',
    title: 'Chef',
    tab: 'Chef',
    icon: 'fork',
    tone: 'green',
    permissions: ['banquet.kds.view'],
  },
  {
    key: 'kds',
    href: '/banquet/kds',
    title: 'KDS',
    tab: 'KDS',
    icon: 'monitor',
    tone: 'blue',
    permissions: ['banquet.kds.view'],
  },
];

export function visibleBanquetSections(permissions: readonly string[] | undefined): BanquetSection[] {
  return BANQUET_SECTIONS.filter((s) => hasAnyPermission(permissions, s.permissions));
}

/** True when the viewer may open at least one banquet screen at this branch. */
export function hasBanquetAccess(permissions: readonly string[] | undefined): boolean {
  return visibleBanquetSections(permissions).length > 0;
}

/** True for `/banquet` and every path under it. */
export function isBanquetPath(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === '/banquet' || pathname.startsWith('/banquet/'));
}

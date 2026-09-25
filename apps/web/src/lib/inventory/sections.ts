import { hasPermission, PERMISSION_KEYS } from '@/lib/auth/permissions';
import type { TabItem } from '@/components/app/screen-tab-bar';

/**
 * The inventory area's bottom bar, after Home: the inventory itself, then
 * Purchase and More — whose screens are still to be built and say so.
 */
export const INVENTORY_SECTIONS: readonly TabItem[] = [
  { key: 'inventory', href: '/inventory', tab: 'Inventory', icon: 'archive', tone: 'green' },
  { key: 'purchase', href: '/inventory/purchase', tab: 'Purchase', icon: 'truck', tone: 'blue' },
  { key: 'more', href: '/inventory/more', tab: 'More', icon: 'moreCircle', tone: 'purple' },
];

/**
 * Inventory spans branches, so access is read from the company-wide set (a
 * permission held at ANY branch): someone with inventory.view somewhere may
 * open the area, and the grid shows the branches where they hold it.
 */
export function hasInventoryAccess(companyPermissions: readonly string[] | undefined): boolean {
  return hasPermission(companyPermissions, PERMISSION_KEYS.INVENTORY_VIEW);
}

/** True for `/inventory` and every path under it. */
export function isInventoryPath(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === '/inventory' || pathname.startsWith('/inventory/'));
}

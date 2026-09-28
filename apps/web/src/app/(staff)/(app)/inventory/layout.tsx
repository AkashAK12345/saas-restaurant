'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasInventoryAccess, INVENTORY_SECTIONS } from '@/lib/inventory/sections';
import { ScreenTabBar } from '@/components/app/screen-tab-bar';
import chrome from '@/components/app/screen-chrome.module.css';

/**
 * Inventory area: the module's own frame with its bottom tab bar. It spans
 * branches, so it needs a company but no branch. Someone without inventory
 * access anywhere gets the page inside the ordinary app shell instead, where
 * it shows the API's refusal. The bar is a courtesy; the API enforces the
 * real check on every call.
 */
const TASK_SCREENS = ['/inventory/manual-purchase', '/inventory/transfer'];
/** Everything under these is a task screen too: an order, and its print view. */
const TASK_PREFIXES = ['/inventory/purchase/'];

export default function InventoryLayout({ children }: { children: ReactNode }) {
  const { selectedCompanyId, companyPermissions, loading } = useAppContext();
  const pathname = usePathname();

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading…
      </p>
    );
  }
  if (!selectedCompanyId || !hasInventoryAccess(companyPermissions)) return <section>{children}</section>;
  // A task screen (recording a purchase, a transfer, receiving an order) has its own action bar at the foot
  // and a back arrow, as the reference draws it: no tab bar under it.
  if (TASK_SCREENS.includes(pathname) || TASK_PREFIXES.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <div className={chrome.frame}>
      <div className={chrome.body}>{children}</div>
      <ScreenTabBar items={INVENTORY_SECTIONS} label="Inventory sections" />
    </div>
  );
}

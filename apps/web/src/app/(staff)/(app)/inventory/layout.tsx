'use client';

import type { ReactNode } from 'react';
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
export default function InventoryLayout({ children }: { children: ReactNode }) {
  const { selectedCompanyId, companyPermissions, loading } = useAppContext();

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading…
      </p>
    );
  }
  if (!selectedCompanyId || !hasInventoryAccess(companyPermissions)) return <section>{children}</section>;

  return (
    <div className={chrome.frame}>
      <div className={chrome.body}>{children}</div>
      <ScreenTabBar items={INVENTORY_SECTIONS} label="Inventory sections" />
    </div>
  );
}

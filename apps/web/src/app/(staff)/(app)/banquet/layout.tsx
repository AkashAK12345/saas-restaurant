'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { visibleBanquetSections } from '@/lib/banquet/sections';
import { ScreenTabBar } from '@/components/app/screen-tab-bar';
import styles from '@/components/banquet/banquet.module.css';
import chrome from '@/components/app/screen-chrome.module.css';

/**
 * Banquet area: a branch requirement, then the module's own frame — each
 * screen renders its header, and this layout adds the bottom tab bar of the
 * sections this viewer may open.
 *
 * Someone with no banquet permission at the branch gets the page inside the
 * ordinary app shell instead, where it shows the API's refusal. The bar is a
 * courtesy; the API enforces the real check on every call.
 */
export default function BanquetLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { selectedBranchId, branchPermissions, loading } = useAppContext();
  const sections = visibleBanquetSections(branchPermissions);

  // The main navigation's Banquet entry and the home workspace card both open
  // /banquet — the bookings list. Someone allowed into the banquet area but
  // not its bookings (a chef: kitchen only) would land on a refusal, with the
  // one section they can use tucked away in a tab. Send them to the first
  // section they may open instead. Navigation only: the API still refuses
  // bookings to them.
  const landing =
    !loading && selectedBranchId && pathname === '/banquet' && sections.length > 0 && !sections.some((s) => s.href === '/banquet')
      ? sections[0]
      : null;
  useEffect(() => {
    if (landing) router.replace(landing.href);
  }, [landing, router]);

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading…
      </p>
    );
  }

  if (!selectedBranchId) {
    return (
      <section>
        <h1>Banquet</h1>
        <p className={styles.empty}>Select a branch to work with its banquet bookings.</p>
      </section>
    );
  }

  if (landing) {
    return (
      <p role="status" aria-live="polite">
        Opening {landing.title}…
      </p>
    );
  }

  if (sections.length === 0) return <section>{children}</section>;

  return (
    <div className={chrome.frame}>
      <div className={chrome.body}>{children}</div>
      <ScreenTabBar items={sections} label="Banquet sections" />
    </div>
  );
}

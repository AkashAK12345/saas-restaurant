'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import styles from '@/components/banquet/banquet.module.css';

/**
 * Banquet area chrome. Links appear only where the branch permission exists —
 * the same courtesy the main navigation applies, and equally not authorization:
 * the API re-checks every call.
 */
const TABS = [
  { href: '/banquet', label: 'Bookings', permission: 'banquet.view' },
  { href: '/banquet/catalog', label: 'Halls & packages', permission: 'banquet.view' },
  { href: '/banquet/kitchen', label: 'Kitchen', permission: 'banquet.kds.view' },
] as const;

export default function BanquetLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { selectedBranchId, branchPermissions, loading } = useAppContext();
  const tabs = TABS.filter((t) => hasPermission(branchPermissions, t.permission));

  // The main navigation's Banquet entry and the home workspace card both open
  // /banquet — the bookings list. Someone allowed into the banquet area but
  // not its bookings (a chef: kitchen only) would land on a refusal, with the
  // one section they can use tucked away in a tab. Send them to the first
  // section they may open instead. Navigation only: the API still refuses
  // bookings to them.
  const landing =
    !loading && selectedBranchId && pathname === '/banquet' && tabs.length > 0 && !tabs.some((t) => t.href === '/banquet')
      ? tabs[0]
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
        Opening {landing.label}…
      </p>
    );
  }

  return (
    <section>
      <nav className={styles.subnav} aria-label="Banquet sections">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`${styles.subnavLink} ${active ? styles.subnavActive : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </section>
  );
}

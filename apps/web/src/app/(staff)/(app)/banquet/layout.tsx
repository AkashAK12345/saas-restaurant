'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
  const { selectedBranchId, branchPermissions, loading } = useAppContext();

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

  const tabs = TABS.filter((t) => hasPermission(branchPermissions, t.permission));

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

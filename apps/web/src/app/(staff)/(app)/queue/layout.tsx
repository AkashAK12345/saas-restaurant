'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import styles from '@/components/queue/queue.module.css';

/**
 * Queue area chrome: a branch requirement and the three queue surfaces.
 *
 * Links are shown only where the branch permission exists — the same courtesy
 * the main navigation applies. The API enforces the real check on every call,
 * so a hidden link protects nothing and a visible one grants nothing.
 */
const TABS = [
  { href: '/queue', label: 'Queue', permission: 'queue.view' },
  { href: '/queue/register', label: 'Register', permission: 'queue.register' },
  { href: '/queue/podium', label: 'Podium', permission: 'queue.call' },
] as const;

export default function QueueLayout({ children }: { children: ReactNode }) {
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
        <h1>Queue</h1>
        <p className={styles.notice}>Select a branch to work with its queue.</p>
      </section>
    );
  }

  const tabs = TABS.filter((t) => hasPermission(branchPermissions, t.permission));

  return (
    <section>
      <nav className={styles.subnav} aria-label="Queue sections">
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

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import styles from '@/components/tasks/tasks.module.css';

/**
 * Task area chrome. Links appear only where the permission exists — the same
 * courtesy the main navigation applies, and equally not authorization.
 */
const TABS = [
  { href: '/tasks', label: 'Board', permission: 'tasks.view' },
  { href: '/tasks/routines', label: 'Routines', permission: 'tasks.view' },
  { href: '/tasks/checklists', label: 'Checklists', permission: 'tasks.view' },
  { href: '/tasks/reports', label: 'Completion', permission: 'tasks.reports.view' },
] as const;

export default function TasksLayout({ children }: { children: ReactNode }) {
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
        <h1>Tasks</h1>
        <p className={styles.empty}>Select a branch to work with its tasks.</p>
      </section>
    );
  }

  const tabs = TABS.filter((t) => hasPermission(branchPermissions, t.permission));

  return (
    <section>
      <nav className={styles.subnav} aria-label="Task sections">
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

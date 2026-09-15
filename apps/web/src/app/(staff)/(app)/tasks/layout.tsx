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
const TABS: ReadonlyArray<{ href: string; label: string; permissions: readonly string[] }> = [
  // Someone who may see only their own tasks still has a board — the server
  // narrows it to their tasks. Routines and checklists are branch-wide
  // definitions, so they stay behind tasks.view.
  { href: '/tasks', label: 'Board', permissions: ['tasks.view', 'tasks.view_own'] },
  { href: '/tasks/routines', label: 'Routines', permissions: ['tasks.view'] },
  { href: '/tasks/checklists', label: 'Checklists', permissions: ['tasks.view'] },
  { href: '/tasks/reports', label: 'Completion', permissions: ['tasks.reports.view'] },
];

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

  const tabs = TABS.filter((t) => t.permissions.some((p) => hasPermission(branchPermissions, p)));

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

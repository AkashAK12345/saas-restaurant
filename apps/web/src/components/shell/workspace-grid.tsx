'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasAnyPermission } from '@/lib/auth/permissions';
import { hasQueueAccess, visibleSurfaces } from '@/lib/queue/surfaces';
import { QueueSheet } from '@/components/queue/queue-sheet';
import { ReportsSheet } from '@/components/reports/reports-sheet';
import { CHECKLIST_REPORTS, type ChecklistReport } from '@/lib/reports/checklist-reports';
import { NavIcon } from './nav-icons';
import { NAV_ITEMS, type NavItem } from './nav-items';
import styles from './workspace.module.css';

/**
 * "Your workspace" — the modules this user can actually open, as big touch
 * targets on the dashboard.
 *
 * It reads the SAME NAV_ITEMS the navigation does, filtered by the same
 * permission rule, so a module can never appear in one place and not the
 * other. Adding a module to the nav puts it here automatically.
 *
 * Queue is the exception in shape, not in rule: its card opens a sheet of the
 * queue screens this user may open, rather than jumping to one of them.
 *
 * The dashboard itself is excluded (you are already on it) and so are the
 * settings pages — this is the operational surface, not administration.
 */
const EXCLUDED = new Set(['/']);

/** One line saying what each module is for. Nav labels alone are too terse. */
const BLURB: Record<string, string> = {
  '/customers': 'Guest records & history',
  '/tables': 'Floor layout & seating',
  '/queue': 'Podium, waiters & displays',
  '/banquet': 'Bookings & events',
  '/tasks': 'Routines & to-dos',
  '/reports': 'Analytics & history',
  '/displays': 'Paired screens & devices',
};

export function workspaceItems(
  permissions: readonly string[],
  hasBranch: boolean,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => {
    if (EXCLUDED.has(item.href) || item.settings || item.href.startsWith('/settings')) return false;
    if (item.requiresBranch && !hasBranch) return false;
    // Any queue screen the viewer may open earns the card — a waiter holding
    // only queue.seat still needs a way in.
    if (item.href === '/queue') return hasQueueAccess(permissions);
    if (item.permissions.length === 0) return true;
    return hasAnyPermission(permissions, item.permissions);
  });
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

export function WorkspaceGrid({
  permissions,
  hasBranch,
}: {
  permissions: readonly string[];
  hasBranch: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const [reportsOpen, setReportsOpen] = useState(false);
  const closeReports = useCallback(() => setReportsOpen(false), []);
  const router = useRouter();
  const openReport = useCallback(
    (report: ChecklistReport) => {
      setReportsOpen(false);
      if (report.reportKey) router.push(`/reports/${report.reportKey}`);
    },
    [router],
  );
  const items = workspaceItems(permissions, hasBranch);
  const surfaces = visibleSurfaces(permissions);
  if (items.length === 0) return null;

  const body = (item: NavItem) => (
    <>
      <span className={styles.tile}>
        <NavIcon name={item.icon} />
      </span>
      <span className={styles.name}>{item.label}</span>
      <span className={styles.blurb}>{BLURB[item.href] ?? ''}</span>
      <span className={styles.open}>
        Open
        <Chevron />
      </span>
    </>
  );

  return (
    <section aria-labelledby="workspace-heading">
      <h2 className={styles.heading} id="workspace-heading">
        Your workspace
      </h2>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.href}>
            {item.href === '/queue' && surfaces.length > 0 ? (
              <button
                type="button"
                className={`${styles.card} ${styles.cardButton}`}
                data-accent={item.accent}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen(true)}
              >
                {body(item)}
              </button>
            ) : item.href === '/reports' ? (
              <button
                type="button"
                className={`${styles.card} ${styles.cardButton}`}
                data-accent={item.accent}
                aria-haspopup="dialog"
                aria-expanded={reportsOpen}
                onClick={() => setReportsOpen(true)}
              >
                {body(item)}
              </button>
            ) : (
              <Link className={styles.card} href={item.href} data-accent={item.accent}>
                {body(item)}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {sheetOpen ? <QueueSheet surfaces={surfaces} onClose={closeSheet} /> : null}
      {reportsOpen ? (
        <ReportsSheet reports={CHECKLIST_REPORTS} onSelect={openReport} onClose={closeReports} />
      ) : null}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { hasAnyPermission } from '@/lib/auth/permissions';
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
 * Home is excluded (you are already on it) and so are the settings pages —
 * this is the operational surface, not administration.
 */
const EXCLUDED = new Set(['/']);

/** One line saying what each module is for. Nav labels alone are too terse. */
const BLURB: Record<string, string> = {
  '/customers': 'Guest records & history',
  '/tables': 'Floor layout & seating',
  '/queue': 'Podium, waiters & displays',
  '/banquet': 'Bookings & events',
  '/tasks': 'Routines & checklists',
  '/reports': 'Performance & exports',
  '/displays': 'Paired screens & devices',
};

export function workspaceItems(
  permissions: readonly string[],
  hasBranch: boolean,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => {
    if (EXCLUDED.has(item.href) || item.href.startsWith('/settings')) return false;
    if (item.requiresBranch && !hasBranch) return false;
    if (item.permissions.length === 0) return true;
    return hasAnyPermission(permissions, item.permissions);
  });
}

export function WorkspaceGrid({
  permissions,
  hasBranch,
}: {
  permissions: readonly string[];
  hasBranch: boolean;
}) {
  const items = workspaceItems(permissions, hasBranch);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="workspace-heading">
      <h2 className={styles.heading} id="workspace-heading">
        Your workspace
      </h2>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.href}>
            <Link className={styles.card} href={item.href} data-accent={item.accent}>
              <span className={styles.tile}>
                <NavIcon name={item.icon} />
              </span>
              <span className={styles.name}>{item.label}</span>
              <span className={styles.blurb}>{BLURB[item.href] ?? ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

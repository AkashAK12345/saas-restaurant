'use client';

import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasAnyPermission } from '@/lib/auth/permissions';
import { NavIcon } from '@/components/shell/nav-icons';
import { settingsItems } from '@/components/shell/nav-items';
import styles from '@/components/shell/workspace.module.css';

/**
 * Settings — the administrative pages, in one place.
 *
 * The bottom bar holds the destinations a shift runs on; everything that is
 * set up once rather than used every service lives here. The list is the same
 * NAV_ITEMS the navigation uses, filtered by the same permission rule, so a
 * page cannot appear here and be missing from the side navigation.
 *
 * "Devices" is the caller's own signed-in sessions, so no permission gates it.
 */
export default function SettingsPage() {
  const { companyPermissions, branchPermissions } = useAppContext();
  const permissions = Array.from(new Set([...companyPermissions, ...branchPermissions]));
  const items = settingsItems().filter(
    (item) => item.permissions.length === 0 || hasAnyPermission(permissions, item.permissions),
  );

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.href}>
            <Link className={styles.card} href={item.href} data-accent={item.accent}>
              <span className={styles.tile}>
                <NavIcon name={item.icon} />
              </span>
              <span className={styles.name}>{item.label}</span>
              <span className={styles.blurb}>{BLURB[item.href] ?? ''}</span>
              <span className={styles.open}>
                Open
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="m9.5 6 6 6-6 6" />
                </svg>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const BLURB: Record<string, string> = {
  '/settings/users': 'People & their roles',
  '/settings/roles': 'Permissions per role',
  '/settings/audit': 'Who changed what',
  '/settings/branches': 'Branches & their details',
  '/settings/devices': 'Your signed-in devices',
};

'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAppContext } from '@/lib/context/app-context-provider';
import { Nav } from './nav';
import { BranchChip } from './branch-chip';
import { Logo } from '@/components/brand/logo';
import styles from './app-shell.module.css';

/**
 * Responsive application chrome.
 *
 *   ≥ 1024px  side navigation + top bar (desktop / landscape tablet)
 *   <  1024px bottom navigation + collapsible context drawer (portrait tablet
 *             / phone). Bottom placement keeps primary actions under the
 *             thumb on a hand-held tablet.
 *
 * Every control is at least 44px tall. Loading and error states for the
 * context are rendered here so pages can assume a resolved context.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const ctx = useAppContext();

  const permissions = useMemo(
    () => Array.from(new Set([...ctx.companyPermissions, ...ctx.branchPermissions])),
    [ctx.companyPermissions, ctx.branchPermissions],
  );
  const hasBranch = !!ctx.selectedBranchId;

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="SAMCO home">
          <Logo variant="mark" height={30} decorative />
        </Link>
        <div className={styles.topContext}>
          <BranchChip />
        </div>
        <div className={styles.user}>
          <span className={styles.userName}>{user?.email}</span>
          {/* Every user's own logins; no permission is needed to see or end them. */}
          <Link href="/settings/devices" className={styles.logout}>
            Devices
          </Link>
          <button type="button" className={styles.logout} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <aside className={styles.sidenav}>
        <Nav permissions={permissions} hasBranch={hasBranch} variant="side" />
      </aside>

      <main className={styles.content}>
        {ctx.error ? (
          <div role="alert" className={styles.error}>
            <p>{ctx.error}</p>
            <button type="button" onClick={() => void ctx.reload()}>
              Retry
            </button>
          </div>
        ) : null}
        {ctx.loading ? (
          <p className={styles.loading} role="status" aria-live="polite">
            Loading…
          </p>
        ) : null}
        {children}
      </main>

      <footer className={styles.bottomnav}>
        <Nav permissions={permissions} hasBranch={hasBranch} variant="bottom" />
      </footer>
    </div>
  );
}

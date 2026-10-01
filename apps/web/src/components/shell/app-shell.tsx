'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasQueueAccess, isQueuePath } from '@/lib/queue/surfaces';
import { hasBanquetAccess, isBanquetPath } from '@/lib/banquet/sections';
import { hasInventoryAccess, isInventoryPath } from '@/lib/inventory/sections';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth/permissions';
import { Nav } from './nav';
import { NAV_ITEMS, SETTINGS_ITEM } from './nav-items';
import { comingSoonEntry } from '@/lib/settings/settings-menu';
import { BranchChip } from './branch-chip';
import { Logo } from '@/components/brand/logo';
import { AppIcon } from '@/components/app/icons';
import styles from './app-shell.module.css';

/** The top bar's page name: the deepest navigation entry the path is under. */
/** User Management and the screens under it, which bring their own header. */
const isUsersPath = (pathname: string | null) =>
  !!pathname && (pathname === '/settings/users' || pathname.startsWith('/settings/users/'));

export function pageTitleFor(pathname: string | null): string {
  if (!pathname || pathname === '/') return 'Dashboard';
  if (pathname === '/settings/devices') return 'Devices';
  const placeholder = comingSoonEntry(pathname);
  if (placeholder) return placeholder.title;
  const match = [...NAV_ITEMS, SETTINGS_ITEM].filter((i) => i.href !== '/' && (pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? 'SAMCO';
}

/**
 * Responsive application chrome.
 *
 *   ≥ 1024px  side navigation (with the logo) + top bar
 *   <  1024px bottom navigation + top bar — primary actions under the thumb
 *
 * The top bar carries the page name, the branch pill, the caller's devices and
 * Sign out. The QUEUE screens bring their own header and tab bar, so for a
 * viewer who may open them the shell steps back to the content alone; someone
 * without queue access keeps the full shell there and sees the API's refusal.
 *
 * Every control is at least 44px. Context loading and errors render here so
 * pages can assume a resolved context.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const ctx = useAppContext();
  const pathname = usePathname();

  const permissions = useMemo(
    () => Array.from(new Set([...ctx.companyPermissions, ...ctx.branchPermissions])),
    [ctx.companyPermissions, ctx.branchPermissions],
  );
  const hasBranch = !!ctx.selectedBranchId;

  const status = (
    <>
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
    </>
  );

  // A module with its own header and tab bar takes the whole screen; the app
  // chrome would only repeat itself. Someone WITHOUT access keeps the shell,
  // so the refusal still sits in context with a way out.
  // Inventory spans branches, so it needs none chosen.
  const focused =
    !ctx.loading &&
    ((hasBranch &&
      ((isQueuePath(pathname) && hasQueueAccess(ctx.branchPermissions)) ||
        (isBanquetPath(pathname) && hasBanquetAccess(ctx.branchPermissions)))) ||
      (isInventoryPath(pathname) && hasInventoryAccess(ctx.companyPermissions)) ||
      (isUsersPath(pathname) && hasPermission(ctx.companyPermissions, PERMISSION_KEYS.USERS_VIEW)));
  if (focused) {
    return (
      <main className={styles.focused}>
        {ctx.error ? <div className={styles.focusedStatus}>{status}</div> : null}
        {children}
      </main>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <span className={styles.pageTitle}>{pageTitleFor(pathname)}</span>
        <div className={styles.topContext}>
          <BranchChip />
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Sign out"
          title="Sign out"
          onClick={() => void logout()}
        >
          <AppIcon name="logout" size={22} />
        </button>
      </header>

      <aside className={styles.sidenav}>
        <Link className={styles.brand} href="/" aria-label="SAMCO home">
          <Logo variant="full" height={34} decorative />
        </Link>
        <Nav permissions={permissions} hasBranch={hasBranch} variant="side" />
      </aside>

      <main className={styles.content}>
        {status}
        {children}
      </main>

      <footer className={styles.bottomnav}>
        <Nav permissions={permissions} hasBranch={hasBranch} variant="bottom" />
      </footer>
    </div>
  );
}

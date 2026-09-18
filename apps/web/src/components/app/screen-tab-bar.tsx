'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PermissionKey } from '@/lib/auth/permissions';
import { AppIcon, type AppIconName } from './icons';
import styles from './screen-chrome.module.css';

/**
 * One destination in a module's bottom bar. The queue's surfaces and the
 * banquet's sections both satisfy this, so a module describes its screens once
 * and the bar renders them.
 */
export interface TabItem {
  key: string;
  href: string;
  /** Short label under the glyph. */
  tab: string;
  icon: AppIconName;
  tone: 'blue' | 'terracotta' | 'green' | 'amber' | 'purple';
  /** Unused here; modules filter before passing. Kept so one list serves both. */
  permissions?: readonly PermissionKey[];
}

/**
 * A module's bottom tab bar: Home, then every screen of this module the viewer
 * may open. The current screen is marked with aria-current as well as its
 * tone, so colour never carries that alone.
 */
export function ScreenTabBar({ items, label }: { items: readonly TabItem[]; label: string }) {
  const pathname = usePathname() ?? '';

  return (
    <nav className={styles.tabbar} aria-label={label}>
      <ul className={styles.tabs}>
        <li>
          <Link href="/" className={styles.tab}>
            <span className={styles.tabIcon}>
              <AppIcon name="home" />
            </span>
            <span className={styles.tabLabel}>Home</span>
          </Link>
        </li>
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-tone={item.tone}
                className={`${styles.tab} ${active ? styles.tabActive : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.tabIcon}>
                  <AppIcon name={item.icon} />
                </span>
                <span className={styles.tabLabel}>{item.tab}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

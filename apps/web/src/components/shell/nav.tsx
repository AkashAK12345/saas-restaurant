'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { hasAnyPermission } from '@/lib/auth/permissions';
import { NAV_ITEMS, type NavItem } from './nav-items';
import { NavIcon } from './nav-icons';
import styles from './nav.module.css';

export interface NavProps {
  /** Union of company + branch effective permissions for the current selection. */
  permissions: readonly string[];
  hasBranch: boolean;
  variant: 'side' | 'bottom';
  onNavigate?: () => void;
}

export function visibleNavItems(
  permissions: readonly string[],
  hasBranch: boolean,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => {
    if (item.requiresBranch && !hasBranch) return false;
    if (item.permissions.length === 0) return true;
    return hasAnyPermission(permissions, item.permissions);
  });
}

/**
 * Permission-aware navigation. Hides what the user cannot use so the UI is
 * not a wall of dead links — and nothing more. Every page behind these links
 * still asks the backend, which enforces the real answer.
 */
export function Nav({ permissions, hasBranch, variant, onNavigate }: NavProps) {
  const pathname = usePathname();
  const items = visibleNavItems(permissions, hasBranch);

  return (
    <nav className={variant === 'side' ? styles.side : styles.bottom} aria-label="Main">
      <ul className={styles.list}>
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                // The accent drives the tile tint; `active` decides whether it
                // is filled. Colour alone never marks the current page —
                // aria-current does that, for everyone.
                data-accent={item.accent}
                className={`${styles.link} ${active ? styles.active : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
              >
                <span className={styles.tile}>
                  <NavIcon name={item.icon} />
                </span>
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

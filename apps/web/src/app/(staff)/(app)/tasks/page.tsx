'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth/auth-provider';
import type { AuthUser } from '@/lib/api/types';
import { QUICK_ACCESS_ITEMS } from '@/lib/tasks/quick-access';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import chrome from '@/components/app/screen-chrome.module.css';
import styles from '@/components/tasks/task-dashboard.module.css';

/** The email's local part, when there's no name on file — "metheakash12" for metheakash12@example.com. */
function displayName(user: AuthUser | null): string {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.email.split('@')[0];
}

/**
 * The Tasks section's home: a Quick Access shortcut to every daily report or
 * checklist a branch submits, one tap from anywhere in the app.
 *
 * Each shortcut is being built out one at a time — see quick-access.ts — so a
 * tile that isn't wired to its real flow yet still opens to a plain "not yet"
 * screen rather than a dead link.
 */
export default function TaskDashboardPage() {
  const { user } = useAuth();

  return (
    <>
      <ScreenHeader crumb={`Tasks · Welcome, ${displayName(user)}`} title="Task Dashboard" plain />
      <div className={chrome.content}>
        <h2 className={styles.sectionTitle}>Quick Access</h2>
        <ul className={styles.list}>
          {QUICK_ACCESS_ITEMS.map((item) => (
            <li key={item.key}>
              <Link href={`/tasks/quick/${item.key}`} className={styles.row}>
                <span className={styles.tile}>
                  <AppIcon name={item.icon} size={22} />
                </span>
                <span className={styles.main}>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.description}>{item.description}</span>
                </span>
                <span className={styles.chevron}>
                  <AppIcon name="chevronRight" size={20} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import { QUICK_ACCESS_ITEMS } from '@/lib/tasks/quick-access';
import chrome from '@/components/app/screen-chrome.module.css';
import styles from '@/components/tasks/task-dashboard.module.css';

/**
 * A Quick Access tile's destination. Each one is being built out on its own
 * — see quick-access.ts — so until a tile has its real submission flow, it
 * opens here instead of a dead link.
 */
export default function TaskQuickAccessPage() {
  const params = useParams<{ key: string }>();
  const item = QUICK_ACCESS_ITEMS.find((i) => i.key === params.key);

  return (
    <>
      <ScreenHeader crumb="Tasks · Quick Access" title={item?.title ?? 'Not found'} plain />
      <div className={chrome.content}>
        {item ? (
          <div className={styles.placeholder}>
            <span className={styles.placeholderTile}>
              <AppIcon name={item.icon} size={30} />
            </span>
            <p className={styles.placeholderTitle}>{item.title}</p>
            <p className={styles.placeholderNote}>{item.description} — this screen is being built next.</p>
            <Link href="/tasks">&larr; Back to Task Dashboard</Link>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <p className={styles.placeholderTitle}>No such shortcut</p>
            <Link href="/tasks">&larr; Back to Task Dashboard</Link>
          </div>
        )}
      </div>
    </>
  );
}

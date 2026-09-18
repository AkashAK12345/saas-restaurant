'use client';

import type { ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { visibleSurfaces } from '@/lib/queue/surfaces';
import { ScreenTabBar } from '@/components/app/screen-tab-bar';
import styles from '@/components/queue/queue.module.css';
import chrome from '@/components/app/screen-chrome.module.css';

/**
 * Queue area: a branch requirement, then the queue's own frame — each screen
 * renders its header, and this layout adds the bottom tab bar of the screens
 * this viewer may open.
 *
 * Someone with no queue permission at the branch gets the page inside the
 * ordinary app shell instead, where it shows the API's refusal. The tab bar is
 * a courtesy; the API enforces the real check on every call.
 */
export default function QueueLayout({ children }: { children: ReactNode }) {
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
        <h1>Queue</h1>
        <p className={styles.notice}>Select a branch to work with its queue.</p>
      </section>
    );
  }

  const surfaces = visibleSurfaces(branchPermissions);
  if (surfaces.length === 0) return <section>{children}</section>;

  return (
    <div className={chrome.frame}>
      <div className={chrome.body}>{children}</div>
      <ScreenTabBar items={surfaces} label="Queue sections" />
    </div>
  );
}

'use client';

import type { StreamStatus } from '@/lib/realtime/sse-client';
import type { QueueCounts } from '@/lib/queue/types';
import styles from './queue.module.css';

const STREAM_TEXT: Record<StreamStatus, string> = {
  idle: 'Connecting…',
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
};

const STREAM_DOT: Record<StreamStatus, string> = {
  idle: styles.dotWaiting,
  connecting: styles.dotWaiting,
  open: styles.dotOpen,
  reconnecting: styles.dotWaiting,
  closed: styles.dotClosed,
};

/**
 * Day counts plus an honest connection indicator.
 *
 * The indicator matters operationally: while it does not say "Live", the board
 * may be behind, so the manual refresh stays available at all times rather
 * than being hidden behind the realtime happy path.
 */
export function QueueStatusBar({
  counts,
  serviceDate,
  stream,
  updatedAt,
  onRefresh,
  busy,
}: {
  counts: QueueCounts;
  serviceDate: string;
  stream: StreamStatus;
  updatedAt: number | null;
  onRefresh: () => void;
  busy?: boolean;
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.counts}>
        <span className={styles.countItem}>
          <strong>{counts.waiting}</strong> waiting
        </span>
        <span className={styles.countItem}>
          <strong>{counts.called}</strong> called
        </span>
        <span className={styles.countItem}>
          <strong>{counts.seated}</strong> seated
        </span>
        <span className={styles.countItem}>
          <strong>{counts.no_show}</strong> no show
        </span>
        <span className={styles.countItem}>
          <strong>{counts.cancelled}</strong> cancelled
        </span>
        <span className={styles.countItem}>{serviceDate}</span>
      </div>

      <span className={styles.spacer} />

      <span className={styles.stream} role="status" aria-live="polite">
        <span className={`${styles.dot} ${STREAM_DOT[stream]}`} aria-hidden="true" />
        {STREAM_TEXT[stream]}
        {updatedAt ? (
          <span className="sr-only">
            Last updated {new Date(updatedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </span>

      <button type="button" className={styles.action} onClick={onRefresh} disabled={busy}>
        Refresh
      </button>
    </div>
  );
}

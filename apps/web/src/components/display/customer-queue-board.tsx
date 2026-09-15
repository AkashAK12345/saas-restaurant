'use client';

import type { StreamStatus } from '@/lib/realtime/sse-client';
import type { QueueCustomerBoard } from '@/lib/queue/types';
import styles from './display.module.css';
import { Logo } from '@/components/brand/logo';

const DOT: Record<StreamStatus, string> = {
  idle: styles.dotWaiting,
  connecting: styles.dotWaiting,
  open: styles.dotOpen,
  reconnecting: styles.dotWaiting,
  closed: styles.dotClosed,
};

function clock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The public queue screen.
 *
 * Shows token numbers and, where one is assigned, the table to go to. It
 * cannot show more than that: the API projection for a QUEUE_CUSTOMER device
 * contains no names, no party sizes and no customer ids at all, so there is
 * nothing here that could identify a guest to the room.
 */
export function CustomerQueueBoard({
  board,
  branchName,
  stream,
  stale,
}: {
  board: QueueCustomerBoard;
  branchName?: string;
  stream: StreamStatus;
  stale?: boolean;
}) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Logo variant="mark" height={40} className={styles.logo} />
        <h1 className={styles.title}>Now serving</h1>
        {branchName ? <span className={styles.branch}>{branchName}</span> : null}
      </header>

      {board.now_serving.length > 0 ? (
        <div className={styles.serving} aria-live="polite">
          {board.now_serving.map((e) => (
            <div key={e.token_number} className={styles.servingCard}>
              <span className={styles.servingNumber}>{e.token_number}</span>
              {e.table_label ? (
                <span className={styles.servingTable}>Table {e.table_label}</span>
              ) : (
                <span className={styles.servingTable}>Please come to the podium</span>
              )}
              {e.called_at ? <span className={styles.servingTime}>{clock(e.called_at)}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.idle} aria-live="polite">
          Please wait to be called
        </p>
      )}

      {board.waiting_tokens.length > 0 ? (
        <section className={styles.waitingTiles} aria-label="Waiting">
          <span className={styles.waitingTitle}>Waiting</span>
          <ul className={styles.waitingList}>
            {board.waiting_tokens.map((n) => (
              <li key={n} className={styles.waitingTile}>
                {n}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <span className={styles.waiting}>
          <strong>{board.waiting_count}</strong> waiting
        </span>

        {board.recently_seated.length > 0 ? (
          <ul className={styles.recent} aria-label="Recently seated">
            {board.recently_seated.map((e) => (
              <li key={e.token_number} className={styles.recentItem}>
                {e.token_number}
                {e.table_label ? ` · ${e.table_label}` : ''}
              </li>
            ))}
          </ul>
        ) : null}

        <span className={styles.conn}>
          <span className={`${styles.dot} ${DOT[stream]}`} aria-hidden="true" />
          {stale ? <span className={styles.stale}>Reconnecting…</span> : <span>Live</span>}
        </span>
      </footer>
    </div>
  );
}

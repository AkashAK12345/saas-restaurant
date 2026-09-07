'use client';

import type { StreamStatus } from '@/lib/realtime/sse-client';
import type { QueueAdminBoard, QueueTokenPublic } from '@/lib/queue/types';
import styles from './display.module.css';

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

function Column({
  title,
  tokens,
  emptyText,
  stamp,
}: {
  title: string;
  tokens: QueueTokenPublic[];
  emptyText: string;
  stamp: (t: QueueTokenPublic) => string;
}) {
  return (
    <section className={styles.adminColumn}>
      <div className={styles.adminHead}>
        <span>{title}</span>
        <span className={styles.adminCount}>{tokens.length}</span>
      </div>
      {tokens.length === 0 ? (
        <p className={styles.adminEmpty}>{emptyText}</p>
      ) : (
        <ul className={styles.adminList}>
          {tokens.map((t) => (
            <li key={t.id} className={styles.adminRow}>
              <span className={styles.adminNumber}>{t.token_number}</span>
              <span className={styles.adminMeta}>
                {t.party_size} {t.party_size === 1 ? 'guest' : 'guests'}
                {stamp(t) ? ` · ${stamp(t)}` : ''}
              </span>
              {t.assigned_table ? (
                <span className={styles.adminTable}>Table {t.assigned_table.label}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The operational queue screen for back-of-house.
 *
 * Richer than the public board — party sizes, tables and the full day's
 * counts — but still a DEVICE, not a user: the API projection for a
 * QUEUE_ADMIN device carries no customer identity, and this screen is
 * read-only. Anything that changes the queue happens at the podium, through
 * staff RBAC.
 */
export function AdminQueueBoard({
  board,
  branchName,
  stream,
  stale,
}: {
  board: QueueAdminBoard;
  branchName?: string;
  stream: StreamStatus;
  stale?: boolean;
}) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Queue overview</h1>
        <span className={styles.branch}>
          {branchName ? `${branchName} · ` : ''}
          {board.service_date}
        </span>
      </header>

      <div className={styles.adminGrid}>
        <Column
          title="Waiting"
          tokens={board.waiting}
          emptyText="Nobody waiting"
          stamp={(t) => `joined ${clock(t.created_at)}`}
        />
        <Column
          title="Called"
          tokens={board.called}
          emptyText="Nobody called"
          stamp={(t) => `called ${clock(t.called_at)}`}
        />
        <Column
          title="Seated"
          tokens={board.seated}
          emptyText="Nobody seated"
          stamp={(t) => `seated ${clock(t.seated_at)}`}
        />
      </div>

      <footer className={styles.footer}>
        <span className={styles.adminCounts}>
          <span className={styles.waiting}>
            <strong>{board.counts.waiting}</strong> waiting
          </span>
          <span className={styles.waiting}>
            <strong>{board.counts.called}</strong> called
          </span>
          <span className={styles.waiting}>
            <strong>{board.counts.seated}</strong> seated
          </span>
          <span className={styles.waiting}>
            <strong>{board.counts.no_show}</strong> no show
          </span>
          <span className={styles.waiting}>
            <strong>{board.counts.cancelled}</strong> cancelled
          </span>
        </span>

        <span className={styles.conn}>
          <span className={`${styles.dot} ${DOT[stream]}`} aria-hidden="true" />
          {stale ? <span className={styles.stale}>Reconnecting…</span> : <span>Live</span>}
        </span>
      </footer>
    </div>
  );
}

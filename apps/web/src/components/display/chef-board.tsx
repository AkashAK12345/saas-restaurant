'use client';

import type { StreamStatus } from '@/lib/realtime/sse-client';
import { KDS_STATUS_LABEL, type BanquetKdsStatus, type ChefBoard } from '@/lib/banquet/types';
import styles from './display.module.css';
import { Logo } from '@/components/brand/logo';

const DOT: Record<StreamStatus, string> = {
  idle: styles.dotWaiting,
  connecting: styles.dotWaiting,
  open: styles.dotOpen,
  reconnecting: styles.dotWaiting,
  closed: styles.dotClosed,
};

const ITEM_CLASS: Record<BanquetKdsStatus, string> = {
  PENDING: styles.chefPending,
  IN_PROGRESS: styles.chefCooking,
  READY: styles.chefReady,
};

function clock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The kitchen screen.
 *
 * Shows the room, the covers, the service time, the kitchen notes and the
 * dishes with how far along each is. It cannot show more: the API projection
 * for a BANQUET_CHEF device contains no customer identity and no money at all,
 * so there is nothing here that could put a guest's name or a price on a wall.
 *
 * Read-only by construction — a device has no mutation route to call.
 */
export function ChefQueueBoard({
  board,
  branchName,
  stream,
  stale,
}: {
  board: ChefBoard;
  branchName?: string;
  stream: StreamStatus;
  stale?: boolean;
}) {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Logo variant="mark" height={40} className={styles.logo} />
        <h1 className={styles.title}>Kitchen</h1>
        <span className={styles.branch}>
          {branchName ? `${branchName} · ` : ''}
          {board.service_date}
        </span>
      </header>

      {board.bookings.length === 0 ? (
        <p className={styles.idle} aria-live="polite">
          No events today
        </p>
      ) : (
        <div className={styles.chefGrid}>
          {board.bookings.map((b) => (
            <section key={b.id} className={styles.chefCard} aria-label={`Event in ${b.hall_name}`}>
              <div className={styles.chefHead}>
                <span className={styles.chefHall}>{b.hall_name}</span>
                <span className={styles.chefCovers}>{b.guest_count} covers</span>
              </div>
              <div className={styles.chefTime}>
                {b.service_at ? `Service ${clock(b.service_at)}` : `Starts ${clock(b.starts_at)}`}
              </div>
              {b.kitchen_notes ? <p className={styles.chefNotes}>{b.kitchen_notes}</p> : null}
              <ul className={styles.chefItems}>
                {b.items.map((i) => (
                  <li key={i.id} className={`${styles.chefItem} ${ITEM_CLASS[i.kds_status]}`}>
                    <span>{i.name}</span>
                    <span className={styles.chefState}>{KDS_STATUS_LABEL[i.kds_status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer className={styles.footer}>
        <span className={styles.waiting}>
          <strong>{board.counts.pending}</strong> pending · <strong>{board.counts.in_progress}</strong>{' '}
          cooking · <strong>{board.counts.ready}</strong> ready
        </span>
        <span className={styles.conn}>
          <span className={`${styles.dot} ${DOT[stream]}`} aria-hidden="true" />
          {stale ? <span className={styles.stale}>Reconnecting…</span> : <span>Live</span>}
        </span>
      </footer>
    </div>
  );
}

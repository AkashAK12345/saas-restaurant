'use client';

import { useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { useKdsBoard } from '@/lib/banquet/use-kds-board';
import { KDS_STATUS_LABEL, type BanquetKdsStatus } from '@/lib/banquet/types';
import type { StreamStatus } from '@/lib/realtime/sse-client';
import styles from '@/components/banquet/banquet.module.css';

const ITEM_CLASS: Record<BanquetKdsStatus, string> = {
  PENDING: styles.itemPending,
  IN_PROGRESS: styles.itemCooking,
  READY: styles.itemReady,
};

const DOT: Record<StreamStatus, string> = {
  idle: styles.dotWaiting,
  connecting: styles.dotWaiting,
  open: styles.dotOpen,
  reconnecting: styles.dotWaiting,
  closed: styles.dotClosed,
};

const clock = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * The staff kitchen board.
 *
 * Live over SSE and reconciled over REST. Advancing an item is a staff
 * operation (banquet.kds.manage) — the chef display device can only watch.
 */
export default function BanquetKitchenPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const { board, loading, error, stream, refresh } = useKdsBoard(ctx);
  const mayManage = hasPermission(branchPermissions, 'banquet.kds.manage');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const advance = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading the kitchen board…
      </p>
    );
  }

  if (error && !board) {
    return (
      <div role="alert" className={styles.error}>
        <p>{error}</p>
        <button type="button" className={styles.action} onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  if (!board) return null;

  return (
    <>
      <h1>Kitchen</h1>

      <div className={styles.bar}>
        <span className={styles.meta}>
          {board.service_date} · {board.counts.events} events · {board.counts.pending} pending ·{' '}
          {board.counts.in_progress} cooking · {board.counts.ready} ready
        </span>
        <span className={styles.spacer} />
        <span className={styles.stream} role="status" aria-live="polite">
          <span className={`${styles.dot} ${DOT[stream]}`} aria-hidden="true" />
          {stream === 'open' ? 'Live' : 'Reconnecting…'}
        </span>
        <button type="button" className={styles.action} onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </div>

      {actionError ? (
        <div role="alert" className={styles.error}>
          {actionError}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      {board.bookings.length === 0 ? (
        <p className={styles.empty}>No confirmed events for this day.</p>
      ) : (
        <div className={styles.kdsGrid}>
          {board.bookings.map((b) => (
            <section key={b.id} className={styles.panel}>
              <div className={styles.cardTop}>
                <span className={styles.title}>{b.hall_name}</span>
                <span className={styles.spacer} />
                <span className={styles.meta}>{b.guest_count} guests</span>
              </div>
              <div className={styles.meta}>
                {b.customer_name ? `${b.customer_name} · ` : ''}
                {clock(b.service_at) ? `service ${clock(b.service_at)}` : `starts ${clock(b.starts_at)}`}
              </div>
              {b.kitchen_notes ? <p className={styles.notice}>{b.kitchen_notes}</p> : null}

              <ul className={styles.items}>
                {b.items.map((i) => (
                  <li key={i.id} className={`${styles.item} ${ITEM_CLASS[i.kds_status]}`}>
                    <span className={styles.itemName}>{i.name}</span>
                    <span className={styles.badge}>{KDS_STATUS_LABEL[i.kds_status]}</span>
                    {mayManage && i.kds_status === 'PENDING' ? (
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        onClick={() => void advance(() => banquetApi.startItem(ctx!, i.id))}
                      >
                        Start
                      </button>
                    ) : null}
                    {mayManage && i.kds_status !== 'READY' ? (
                      <button
                        type="button"
                        className={`${styles.action} ${styles.primary}`}
                        disabled={busy}
                        onClick={() => void advance(() => banquetApi.readyItem(ctx!, i.id))}
                      >
                        Ready
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

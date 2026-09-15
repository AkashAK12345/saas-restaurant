'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { useKdsBoard } from '@/lib/banquet/use-kds-board';
import {
  KDS_STATUS_LABEL,
  PLATE_STATUS_LABEL,
  type BanquetKdsStatus,
  type PlateRequest,
} from '@/lib/banquet/types';
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
 *
 * Plate requests from the floor appear here too. Someone other than the person
 * who asked approves or rejects (the API and the database refuse a self-
 * decision); approved plates are then marked dispatched. Every request event
 * arrives on the same kitchen stream, so the list stays live.
 */
export default function BanquetKitchenPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const { user } = useAuth();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const { board, loading, error, stream, updatedAt, refresh } = useKdsBoard(ctx);
  const mayManage = hasPermission(branchPermissions, 'banquet.kds.manage');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [plates, setPlates] = useState<PlateRequest[] | null>(null);
  const [platesError, setPlatesError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const serviceDate = board?.service_date;
  // Every board refresh (an action here, or any kitchen event on the stream)
  // re-reads the plate requests for the same day.
  useEffect(() => {
    if (!ctx || !serviceDate) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await banquetApi.kitchenPlateRequests(ctx, serviceDate);
        if (!cancelled) {
          setPlates(res?.requests ?? []);
          setPlatesError(null);
        }
      } catch (e) {
        if (!cancelled) setPlatesError(e instanceof Error ? e.message : 'Could not load plate requests');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, serviceDate, updatedAt]);

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

  const open = (plates ?? []).filter((p) => p.status === 'REQUESTED' || p.status === 'APPROVED');
  const closed = (plates ?? []).filter((p) => p.status === 'REJECTED' || p.status === 'DISPATCHED');

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

      <section className={styles.panel} aria-labelledby="plates-title">
        <h2 className={styles.panelTitle} id="plates-title">
          Plate requests
        </h2>
        {platesError ? (
          <p role="alert" className={styles.error}>
            {platesError}
          </p>
        ) : plates === null ? (
          <p role="status" aria-live="polite">
            Loading plate requests…
          </p>
        ) : plates.length === 0 ? (
          <p className={styles.empty}>No plate requests for this day.</p>
        ) : (
          <>
            {open.length === 0 ? <p className={styles.empty}>Nothing waiting on the kitchen.</p> : null}
            <ul className={styles.items} aria-label="Open plate requests">
              {open.map((p) => {
                const own = p.requested_by.id === user?.id;
                return (
                  <li key={p.id} className={styles.item}>
                    <span className={styles.itemName}>
                      {p.plates} × {p.item.name}
                      <span className={styles.meta}>
                        {' '}
                        · {p.hall_name ?? 'Hall'} · asked by {p.requested_by.name} at {clock(p.requested_at)}
                        {p.note ? ` · “${p.note}”` : ''}
                      </span>
                    </span>
                    <span className={styles.badge}>{PLATE_STATUS_LABEL[p.status]}</span>
                    {mayManage && p.status === 'REQUESTED' && !own && rejecting !== p.id ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.action} ${styles.primary}`}
                          disabled={busy}
                          aria-label={`Approve ${p.plates} plates of ${p.item.name}`}
                          onClick={() => void advance(() => banquetApi.approvePlates(ctx!, p.id))}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className={styles.action}
                          disabled={busy}
                          aria-label={`Reject ${p.plates} plates of ${p.item.name}`}
                          onClick={() => {
                            setRejecting(p.id);
                            setReason('');
                          }}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {mayManage && p.status === 'REQUESTED' && own ? (
                      <span className={styles.meta}>Your request — another cook decides</span>
                    ) : null}
                    {mayManage && p.status === 'APPROVED' ? (
                      <button
                        type="button"
                        className={`${styles.action} ${styles.primary}`}
                        disabled={busy}
                        aria-label={`Dispatch ${p.plates} plates of ${p.item.name}`}
                        onClick={() => void advance(() => banquetApi.dispatchPlates(ctx!, p.id))}
                      >
                        Dispatched
                      </button>
                    ) : null}
                    {rejecting === p.id ? (
                      <form
                        className={styles.bar}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!reason.trim()) return;
                          void advance(async () => {
                            await banquetApi.rejectPlates(ctx!, p.id, reason.trim());
                            setRejecting(null);
                          });
                        }}
                      >
                        <label className={styles.label} htmlFor={`reject-${p.id}`}>
                          Reason for rejecting
                        </label>
                        <input
                          id={`reject-${p.id}`}
                          className={styles.input}
                          maxLength={200}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button type="submit" className={styles.action} disabled={busy || !reason.trim()}>
                          Confirm rejection
                        </button>
                        <button type="button" className={styles.action} onClick={() => setRejecting(null)}>
                          Keep it
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {closed.length > 0 ? (
              <details>
                <summary>Done today ({closed.length})</summary>
                <ul className={styles.items} aria-label="Finished plate requests">
                  {closed.map((p) => (
                    <li key={p.id} className={styles.item}>
                      <span className={styles.itemName}>
                        {p.plates} × {p.item.name}
                        <span className={styles.meta}>
                          {' '}
                          · {p.status === 'REJECTED' ? `rejected by ${p.decided_by?.name ?? '—'}: ${p.rejection_reason}` : `dispatched by ${p.dispatched_by?.name ?? '—'}`}
                        </span>
                      </span>
                      <span className={styles.badge}>{PLATE_STATUS_LABEL[p.status]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>

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

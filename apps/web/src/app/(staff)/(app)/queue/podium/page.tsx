'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi } from '@/lib/queue/api';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { QueueTokenCard } from '@/components/queue/queue-token-card';
import { QueueStatusBar } from '@/components/queue/queue-status-bar';
import type { QueueTableAvailability, QueueToken, RestaurantTable } from '@/lib/queue/types';
import queue from '@/components/queue/queue.module.css';
import styles from './podium.module.css';

/**
 * Podium Operator.
 *
 * One screen to run a shift: the next party to call is unmissable, called
 * parties can be seated (with or without a table), no-showed or cancelled,
 * and seated parties can hand their table back.
 *
 * It reads the SAME queue tokens as every other surface — there is no podium
 * queue — and every action goes through an explicit backend operation, so an
 * illegal move is refused by the state machine rather than silently applied.
 * Concurrency is expected: if another operator calls the same token first,
 * the API returns 409, the message is shown, and the board is refetched.
 */
export default function PodiumPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions, companyPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const { board, loading, error, stream, updatedAt, refresh } = useQueueBoard(ctx);
  const actions = useQueueActions(ctx, refresh);
  const [tables, setTables] = useState<QueueTableAvailability[]>([]);

  const mayCall = hasPermission(branchPermissions, 'queue.call');
  const maySeat = hasPermission(branchPermissions, 'queue.seat');
  const mayNoShow = hasPermission(branchPermissions, 'queue.no_show');
  const mayCancel = hasPermission(branchPermissions, 'queue.cancel');
  const mayRegister = hasPermission(branchPermissions, 'queue.register');
  // Reading a phone number is customer data: both keys, and the API re-checks both.
  const mayContact = mayCall && hasPermission(companyPermissions, 'customers.view');

  // Occupancy comes from the API across EVERY service date — a party seated
  // before midnight still holds its table. Refetched whenever the board
  // changes, since seating and releasing are what change it.
  useEffect(() => {
    if (!ctx || !maySeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await queueApi.tableAvailability(ctx);
        if (!cancelled) setTables(rows);
      } catch {
        if (!cancelled) setTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, maySeat, updatedAt]);

  /**
   * Tables free right now: active, held by nobody on any day, and not taken
   * on the board in the moment since availability was last read. Seating
   * still fails cleanly if one is taken in the meantime.
   */
  const freeTables = useMemo<RestaurantTable[]>(() => {
    if (!board) return [];
    const taken = new Set(
      board.seated.map((t) => t.assigned_table_id).filter((id): id is string => id !== null),
    );
    return tables
      .filter((t) => t.status === 'ACTIVE' && t.occupied_by === null && !taken.has(t.id))
      .map((t) => ({ id: t.id, branch_id: board.branch_id, label: t.label, capacity: t.capacity, zone: t.zone, status: t.status }));
  }, [tables, board]);

  const loadContact = useMemo(
    () => (mayContact && ctx ? (t: QueueToken) => queueApi.contact(ctx, t.id) : undefined),
    [mayContact, ctx],
  );

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading the queue…
      </p>
    );
  }

  if (error && !board) {
    return (
      <div role="alert" className={queue.error}>
        <p>{error}</p>
        <button type="button" className={queue.action} onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  if (!board) return null;

  const next = board.next_waiting;

  return (
    <>
      <h1>Podium</h1>

      <QueueStatusBar
        counts={board.counts}
        serviceDate={board.service_date}
        stream={stream}
        updatedAt={updatedAt}
        onRefresh={() => void refresh()}
        busy={actions.busy}
      />

      {actions.error ? (
        <div role="alert" className={queue.error}>
          {actions.error}
        </div>
      ) : null}
      {actions.notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {actions.notice}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={queue.error}>
          {error}
        </div>
      ) : null}

      {next ? (
        <section className={styles.next} aria-label="Next party">
          <div>
            <span className={styles.nextLabel}>Next up</span>
            <span className={styles.nextNumber}>{next.token_number}</span>
          </div>
          <div className={styles.nextWho}>
            <strong>{next.customer?.name ?? 'Walk-in'}</strong>
            <br />
            {next.party_size} {next.party_size === 1 ? 'guest' : 'guests'}
          </div>
          {mayCall ? (
            <button
              type="button"
              className={styles.nextAction}
              disabled={actions.busy}
              onClick={() => void actions.call(next)}
            >
              Call {next.token_number}
            </button>
          ) : null}
        </section>
      ) : (
        <p className={styles.idle}>Nobody is waiting.</p>
      )}

      <p className={queue.totals} aria-label="Waiting totals">
        <strong>{board.totals.parties}</strong> {board.totals.parties === 1 ? 'party' : 'parties'} waiting ·{' '}
        <strong>{board.totals.adults}</strong> adults · <strong>{board.totals.kids}</strong> kids
        {maySeat && tables.length > 0 ? (
          <>
            {' · '}
            <strong>{freeTables.length}</strong> of {tables.filter((t) => t.status === 'ACTIVE').length} tables free
          </>
        ) : null}
      </p>

      {maySeat && freeTables.length === 0 && tables.length > 0 ? (
        <p className={styles.tablesNote}>Every table is occupied — seat parties without a table, or release one.</p>
      ) : null}

      {board.scheduled.length > 0 ? (
        <div className={queue.column} style={{ marginBottom: 'var(--gap-lg)' }}>
          <div className={queue.columnHead}>
            <h2 className={queue.columnTitle}>Scheduled</h2>
            <span className={queue.count}>{board.scheduled.length}</span>
          </div>
          <ul className={queue.list}>
            {board.scheduled.map((t) => (
              <QueueTokenCard
                key={t.id}
                token={t}
                busy={actions.busy}
                onCheckIn={mayRegister ? actions.checkIn : undefined}
                onCancel={mayCancel ? actions.cancel : undefined}
                loadContact={loadContact}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div className={queue.columns}>
        <div className={queue.column}>
          <div className={queue.columnHead}>
            <h2 className={queue.columnTitle}>Called</h2>
            <span className={queue.count}>{board.called.length}</span>
          </div>
          {board.called.length === 0 ? (
            <p className={queue.empty}>Nobody has been called.</p>
          ) : (
            <ul className={queue.list}>
              {board.called.map((t) => (
                <QueueTokenCard
                  key={t.id}
                  token={t}
                  tables={freeTables}
                  busy={actions.busy}
                  onSeat={maySeat ? actions.seat : undefined}
                  onSkip={mayCall ? actions.skip : undefined}
                  onNoShow={mayNoShow ? actions.noShow : undefined}
                  onCancel={mayCancel ? actions.cancel : undefined}
                  loadContact={loadContact}
                />
              ))}
            </ul>
          )}
        </div>

        <div className={queue.column}>
          <div className={queue.columnHead}>
            <h2 className={queue.columnTitle}>Waiting</h2>
            <span className={queue.count}>{board.waiting.length}</span>
          </div>
          {board.waiting.length === 0 ? (
            <p className={queue.empty}>The waiting list is empty.</p>
          ) : (
            <ul className={queue.list}>
              {board.waiting.map((t) => (
                <QueueTokenCard
                  key={t.id}
                  token={t}
                  busy={actions.busy}
                  highlight={t.id === next?.id}
                  onCall={mayCall ? actions.call : undefined}
                  onCancel={mayCancel ? actions.cancel : undefined}
                  loadContact={loadContact}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={queue.column} style={{ marginTop: 'var(--gap-lg)' }}>
        <div className={queue.columnHead}>
          <h2 className={queue.columnTitle}>Seated</h2>
          <span className={queue.count}>{board.seated.length}</span>
        </div>
        {board.seated.length === 0 ? (
          <p className={queue.empty}>Nobody has been seated yet.</p>
        ) : (
          <ul className={queue.list}>
            {board.seated.map((t) => (
              <QueueTokenCard
                key={t.id}
                token={t}
                tables={freeTables}
                busy={actions.busy}
                onAssignTable={maySeat ? actions.assignTable : undefined}
                onReleaseTable={maySeat ? actions.releaseTable : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

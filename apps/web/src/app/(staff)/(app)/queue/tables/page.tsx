'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi } from '@/lib/queue/api';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { QueueStatusBar } from '@/components/queue/queue-status-bar';
import { formatTime } from '@/lib/format/datetime';
import type { QueueTableAvailability, QueueToken } from '@/lib/queue/types';
import queue from '@/components/queue/queue.module.css';
import styles from '@/components/settings/settings.module.css';

/**
 * Tables — the waiter's floor view (SRS §5.2.4).
 *
 * The podium thinks in parties; a waiter thinks in tables. This screen shows
 * every table of the branch as free or occupied, lets the waiter seat a called
 * party at a free table, and says "table cleared" when guests leave.
 *
 * Nothing here is a second source of truth: occupancy is the queue's seated
 * parties, and every action is the same explicit queue operation the podium
 * uses. Releasing a table publishes on the branch's queue stream, so the
 * podium sees the table free up at once without anyone refreshing.
 */
export default function QueueTablesPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () => (selectedCompanyId && selectedBranchId ? { companyId: selectedCompanyId, branchId: selectedBranchId } : null),
    [selectedCompanyId, selectedBranchId],
  );
  const maySeat = hasPermission(branchPermissions, 'queue.seat');

  const { board, loading, error, stream, updatedAt, refresh } = useQueueBoard(maySeat ? ctx : null);
  const actions = useQueueActions(ctx, refresh);
  const [tables, setTables] = useState<QueueTableAvailability[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ctx || !maySeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await queueApi.tableAvailability(ctx);
        if (!cancelled) setTables(rows ?? []);
      } catch {
        if (!cancelled) setTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, maySeat, updatedAt]);

  if (!maySeat) {
    return (
      <>
        <h1>Tables</h1>
        <p role="alert" className={queue.error}>
          You do not have permission to seat guests at this branch.
        </p>
      </>
    );
  }

  if (loading || tables === null) {
    return (
      <p role="status" aria-live="polite">
        Loading tables…
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

  const tz = selectedBranch?.timezone;
  const seatedHere = new Map(
    board.seated.filter((t) => t.assigned_table_id).map((t) => [t.assigned_table_id as string, t]),
  );
  // Parties a free table can take: called and waiting to be seated, or seated
  // earlier without a table.
  const seatable: Array<{ token: QueueToken; kind: 'seat' | 'assign' }> = [
    ...board.called.map((token) => ({ token, kind: 'seat' as const })),
    ...board.seated.filter((t) => !t.assigned_table_id).map((token) => ({ token, kind: 'assign' as const })),
  ];
  const active = tables.filter((t) => t.status === 'ACTIVE');
  const free = active.filter((t) => !t.occupied_by && !seatedHere.has(t.id));

  return (
    <>
      <h1>Tables</h1>
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
        <p role="status" aria-live="polite" className={styles.notice}>
          {actions.notice}
        </p>
      ) : null}

      <p className={queue.totals} aria-label="Table totals">
        <strong>{free.length}</strong> of {active.length} tables free · <strong>{board.called.length}</strong>{' '}
        {board.called.length === 1 ? 'party' : 'parties'} called and waiting for a table
      </p>

      {tables.length === 0 ? (
        <p className={styles.notice}>This branch has no tables. Add them on the Tables page.</p>
      ) : (
        <ul className={styles.list} aria-label="Floor">
          {tables.map((table) => {
            const today = seatedHere.get(table.id);
            const occupied = today ?? null;
            const heldEarlier = !today && table.occupied_by ? table.occupied_by : null;
            const inService = table.status === 'ACTIVE';
            const picked = choice[table.id] ?? '';
            const pickedEntry = seatable.find((s) => s.token.id === picked);
            return (
              <li key={table.id} className={styles.card} aria-label={`Table ${table.label}`}>
                <div className={styles.cardTop}>
                  <span className={styles.title}>Table {table.label}</span>
                  <span className={styles.badge}>
                    {!inService ? 'Out of service' : occupied || heldEarlier ? 'Occupied' : 'Free'}
                  </span>
                  <span className={styles.meta}>
                    {table.capacity} seats{table.zone ? ` · ${table.zone}` : ''}
                  </span>
                </div>

                {occupied ? (
                  <div className={styles.bar}>
                    <span>
                      Token {occupied.token_number} · {occupied.party_size}{' '}
                      {occupied.party_size === 1 ? 'guest' : 'guests'}
                      {occupied.seated_at ? ` · seated ${formatTime(occupied.seated_at, tz)}` : ''}
                    </span>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={actions.busy}
                      onClick={() => void actions.releaseTable(occupied)}
                    >
                      Table cleared
                    </button>
                  </div>
                ) : heldEarlier ? (
                  <div className={styles.bar}>
                    <span>
                      Token {heldEarlier.token_number}, seated on an earlier service date
                    </span>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={actions.busy}
                      onClick={() => void actions.releaseTable({ id: heldEarlier.token_id } as QueueToken)}
                    >
                      Table cleared
                    </button>
                  </div>
                ) : inService && seatable.length > 0 ? (
                  <form
                    className={styles.bar}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!pickedEntry) return;
                      void (async () => {
                        if (pickedEntry.kind === 'seat') await actions.seat(pickedEntry.token, table.id);
                        else await actions.assignTable(pickedEntry.token, table.id);
                        setChoice((c) => ({ ...c, [table.id]: '' }));
                      })();
                    }}
                  >
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`party-${table.id}`}>
                        Party for table {table.label}
                      </label>
                      <select
                        id={`party-${table.id}`}
                        className={styles.select}
                        value={picked}
                        onChange={(e) => setChoice((c) => ({ ...c, [table.id]: e.target.value }))}
                      >
                        <option value="">Choose a party</option>
                        {seatable.map(({ token, kind }) => (
                          <option key={token.id} value={token.id}>
                            Token {token.token_number} · {token.party_size}{' '}
                            {token.party_size === 1 ? 'guest' : 'guests'}
                            {kind === 'assign' ? ' (seated, no table)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      className={`${styles.button} ${styles.primary}`}
                      disabled={actions.busy || !pickedEntry}
                    >
                      Seat here
                    </button>
                    {pickedEntry && pickedEntry.token.party_size > table.capacity ? (
                      <span className={styles.meta}>
                        A party of {pickedEntry.token.party_size} is more than this table’s {table.capacity} seats.
                      </span>
                    ) : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

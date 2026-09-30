'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { queueApi, type QueueContext } from './api';
import type { QueueToken } from './types';

/**
 * The podium's write operations.
 *
 * Two rules, both learned from the way the backend behaves:
 *
 *  1. NOTHING IS ASSUMED. A request is not a result. Each action awaits the
 *     API response and then refetches the board, so the screen only ever
 *     shows state the server confirmed. There is no optimistic mutation of
 *     the local board.
 *
 *  2. A 409 IS NORMAL, NOT A CRASH. Two operators acting on the same token,
 *     or a table taken a moment earlier, produce a controlled conflict. It is
 *     shown as a plain message and followed by a refetch, so the operator
 *     immediately sees the real state instead of a stale screen.
 */
export interface QueueActionsState {
  busy: boolean;
  error: string | null;
  notice: string | null;
  dismiss: () => void;
  call: (t: QueueToken) => Promise<void>;
  seat: (t: QueueToken, tableId?: string) => Promise<void>;
  noShow: (t: QueueToken) => Promise<void>;
  cancel: (t: QueueToken) => Promise<void>;
  assignTable: (t: QueueToken, tableId: string) => Promise<void>;
  releaseTable: (t: QueueToken) => Promise<void>;
  finish: (t: QueueToken) => Promise<void>;
  skip: (t: QueueToken) => Promise<void>;
  checkIn: (t: QueueToken) => Promise<void>;
}

export function useQueueActions(
  ctx: QueueContext | null,
  refresh: () => Promise<void>,
): QueueActionsState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (op: (c: QueueContext) => Promise<QueueToken>, describe: (t: QueueToken) => string) => {
      if (!ctx) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const token = await op(ctx);
        setNotice(describe(token));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
          // Someone else got there first, or the token moved on.
          setError(`${e.message} — the queue has been refreshed.`);
        } else {
          setError(e instanceof Error ? e.message : 'The action failed');
        }
      } finally {
        // Reconcile in every case, success or failure.
        await refresh();
        setBusy(false);
      }
    },
    [ctx, refresh],
  );

  return {
    busy,
    error,
    notice,
    dismiss: useCallback(() => {
      setError(null);
      setNotice(null);
    }, []),
    call: useCallback(
      (t) => run((c) => queueApi.call(c, t.id), (r) => `Called token ${r.token_number}.`),
      [run],
    ),
    seat: useCallback(
      (t, tableId) =>
        run(
          (c) => queueApi.seat(c, t.id, tableId),
          (r) =>
            `Seated token ${r.token_number}${r.assigned_table ? ` at table ${r.assigned_table.label}` : ''}.`,
        ),
      [run],
    ),
    noShow: useCallback(
      (t) => run((c) => queueApi.noShow(c, t.id), (r) => `Token ${r.token_number} marked as a no show.`),
      [run],
    ),
    cancel: useCallback(
      (t) => run((c) => queueApi.cancel(c, t.id), (r) => `Token ${r.token_number} cancelled.`),
      [run],
    ),
    assignTable: useCallback(
      (t, tableId) =>
        run(
          (c) => queueApi.assignTable(c, t.id, tableId),
          (r) => `Token ${r.token_number} assigned to table ${r.assigned_table?.label ?? ''}.`.trim(),
        ),
      [run],
    ),
    releaseTable: useCallback(
      (t) =>
        run(
          (c) => queueApi.releaseTable(c, t.id),
          (r) =>
            `${t.assigned_table ? `Table ${t.assigned_table.label}` : 'The table'} is free — token ${r.token_number} has left.`,
        ),
      [run],
    ),
    finish: useCallback(
      (t) => run((c) => queueApi.finish(c, t.id), (r) => `Token ${r.token_number} has left.`),
      [run],
    ),
    skip: useCallback(
      (t) =>
        run(
          (c) => queueApi.skip(c, t.id),
          (r) => `Token ${r.token_number} skipped — back on the list behind parties not yet called.`,
        ),
      [run],
    ),
    checkIn: useCallback(
      (t) => run((c) => queueApi.checkIn(c, t.id), (r) => `Token ${r.token_number} checked in and waiting.`),
      [run],
    ),
  };
}

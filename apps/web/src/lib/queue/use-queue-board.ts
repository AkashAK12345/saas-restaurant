'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api/client';
import { StreamClient, type StreamStatus } from '@/lib/realtime/sse-client';
import { queueApi, type QueueContext } from './api';
import { QUEUE_EVENTS, type QueueBoard } from './types';

/**
 * The live queue board for a branch.
 *
 * RECONCILE, DON'T TRUST THE EVENT. A realtime event is treated purely as a
 * signal that the server state changed; the board is then refetched over REST,
 * which is authoritative and permission-checked. That keeps three failure
 * modes harmless: a dropped event, an event that arrives out of order, and a
 * mutation someone else made while we were disconnected.
 *
 * Reconnects are handled the same way — when the stream reopens, the board is
 * refetched, because events published while the socket was down may have
 * fallen outside the replay buffer.
 *
 * Bursts are coalesced: ten events in one second cause one refetch.
 */
const COALESCE_MS = 120;

export interface QueueBoardState {
  board: QueueBoard | null;
  loading: boolean;
  error: string | null;
  stream: StreamStatus;
  /** Timestamp of the last successful load — surfaced as "stale" in the UI. */
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useQueueBoard(ctx: QueueContext | null): QueueBoardState {
  const [board, setBoard] = useState<QueueBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const companyId = ctx?.companyId ?? null;
  const branchId = ctx?.branchId ?? null;
  const scope = useMemo(
    () => (companyId && branchId ? { companyId, branchId } : null),
    [companyId, branchId],
  );

  // Guards against writing state for a scope the user has already left.
  const activeScope = useRef<string>('');
  const scopeKey = scope ? `${scope.companyId}|${scope.branchId}` : '';

  const refresh = useCallback(async () => {
    if (!scope) return;
    const key = `${scope.companyId}|${scope.branchId}`;
    try {
      const next = await queueApi.board(scope);
      if (activeScope.current !== key) return;
      setBoard(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (activeScope.current !== key) return;
      setError(e instanceof Error ? e.message : 'Failed to load the queue');
    }
  }, [scope]);

  useEffect(() => {
    activeScope.current = scopeKey;
    if (!scope) return;

    let cancelled = false;
    let coalesce: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      if (cancelled) return;
      if (coalesce) clearTimeout(coalesce);
      coalesce = setTimeout(() => void refresh(), COALESCE_MS);
    };

    const client = new StreamClient({
      streamUrl: `${apiBaseUrl()}/realtime/stream`,
      getTicket: async () => (await queueApi.streamTicket(scope)).ticket,
      onStatus: (s) => {
        if (cancelled) return;
        setStream(s);
        // A reopened socket may have missed events entirely; resync.
        if (s === 'open') reload();
      },
    });
    for (const type of QUEUE_EVENTS) client.on(type, reload);

    void (async () => {
      await refresh();
      if (!cancelled) void client.connect();
    })();

    return () => {
      cancelled = true;
      if (coalesce) clearTimeout(coalesce);
      client.close();
    };
  }, [scope, scopeKey, refresh]);

  return {
    board,
    loading: scope !== null && board === null && error === null,
    error,
    stream,
    updatedAt,
    refresh,
  };
}

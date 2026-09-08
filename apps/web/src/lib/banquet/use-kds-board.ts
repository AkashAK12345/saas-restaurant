'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api/client';
import { StreamClient, type StreamStatus } from '@/lib/realtime/sse-client';
import { banquetApi, type BanquetContext } from './api';
import { BANQUET_EVENTS, type StaffKdsBoard } from './types';

/**
 * The live kitchen board for a branch.
 *
 * Same discipline as the queue board: a realtime event only means "something
 * changed", and the board is then refetched over REST, which is authoritative
 * and permission-checked. A dropped event, an out-of-order event, or a change
 * made while disconnected all resolve themselves on the next fetch — and the
 * board resyncs whenever the stream reopens.
 */
const COALESCE_MS = 120;

export interface KdsBoardState {
  board: StaffKdsBoard | null;
  loading: boolean;
  error: string | null;
  stream: StreamStatus;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useKdsBoard(ctx: BanquetContext | null, serviceDate?: string): KdsBoardState {
  const [board, setBoard] = useState<StaffKdsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const companyId = ctx?.companyId ?? null;
  const branchId = ctx?.branchId ?? null;
  const scope = useMemo(
    () => (companyId && branchId ? { companyId, branchId } : null),
    [companyId, branchId],
  );

  const activeKey = useRef('');
  const key = `${scope ? `${scope.companyId}|${scope.branchId}` : ''}|${serviceDate ?? ''}`;

  const refresh = useCallback(async () => {
    if (!scope) return;
    const mine = `${scope.companyId}|${scope.branchId}|${serviceDate ?? ''}`;
    try {
      const next = await banquetApi.kdsBoard(scope, serviceDate);
      if (activeKey.current !== mine) return;
      setBoard(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (activeKey.current !== mine) return;
      setError(e instanceof Error ? e.message : 'Failed to load the kitchen board');
    }
  }, [scope, serviceDate]);

  useEffect(() => {
    activeKey.current = key;
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
      getTicket: async () => (await banquetApi.streamTicket(scope)).ticket,
      onStatus: (s) => {
        if (cancelled) return;
        setStream(s);
        if (s === 'open') reload();
      },
    });
    for (const type of BANQUET_EVENTS) client.on(type, reload);

    void (async () => {
      await refresh();
      if (!cancelled) void client.connect();
    })();

    return () => {
      cancelled = true;
      if (coalesce) clearTimeout(coalesce);
      client.close();
    };
  }, [scope, key, refresh]);

  return {
    board,
    loading: scope !== null && board === null && error === null,
    error,
    stream,
    updatedAt,
    refresh,
  };
}

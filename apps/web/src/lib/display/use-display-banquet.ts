'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api/client';
import { StreamClient, type StreamStatus } from '@/lib/realtime/sse-client';
import { BANQUET_EVENTS, type ChefBoard } from '@/lib/banquet/types';
import { DisplayAuthError, displayApi } from './display-api';
import type { DeviceSession } from './device-session';

/**
 * A paired chef screen's live kitchen board.
 *
 * Structurally parallel to useDisplayQueue and deliberately kept separate:
 * the two boards have different shapes and different projections, and folding
 * them into one generic hook would hide which projection a screen is actually
 * receiving — the thing that matters most here.
 *
 * A kitchen screen runs unattended, so it refetches on a slow timer as well as
 * on events: if the stream dies and reconnection keeps failing, the board
 * still catches up rather than showing a stale service.
 */
const COALESCE_MS = 150;
const SAFETY_POLL_MS = 60_000;

export interface DisplayBanquetState {
  board: ChefBoard | null;
  loading: boolean;
  error: string | null;
  unpaired: boolean;
  stream: StreamStatus;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useDisplayBanquet(session: DeviceSession | null): DisplayBanquetState {
  const [board, setBoard] = useState<ChefBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unpaired, setUnpaired] = useState(false);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const key = session ? session.credential.slice(0, 8) + session.branchId : '';
  const activeKey = useRef('');

  const refresh = useCallback(async () => {
    if (!session) return;
    const mine = session.credential.slice(0, 8) + session.branchId;
    try {
      const next = await displayApi.banquetBoard(session);
      if (activeKey.current !== mine) return;
      setBoard(next);
      setError(null);
      setUnpaired(false);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (activeKey.current !== mine) return;
      if (e instanceof DisplayAuthError) {
        setUnpaired(true);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not reach the server');
      }
    }
  }, [session]);

  useEffect(() => {
    activeKey.current = key;
    if (!session) return;

    let cancelled = false;
    let coalesce: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      if (cancelled) return;
      if (coalesce) clearTimeout(coalesce);
      coalesce = setTimeout(() => void refresh(), COALESCE_MS);
    };

    const client = new StreamClient({
      streamUrl: `${apiBaseUrl()}/realtime/stream`,
      getTicket: async () => (await displayApi.streamTicket(session, 'banquet-kds')).ticket,
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

    const safety = setInterval(reload, SAFETY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(safety);
      if (coalesce) clearTimeout(coalesce);
      client.close();
    };
  }, [session, key, refresh]);

  return {
    board,
    loading: session !== null && board === null && error === null,
    error,
    unpaired,
    stream,
    updatedAt,
    refresh,
  };
}

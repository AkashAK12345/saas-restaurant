'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api/client';
import { StreamClient, type StreamStatus } from '@/lib/realtime/sse-client';
import { QUEUE_EVENTS, type QueueAdminBoard, type QueueCustomerBoard } from '@/lib/queue/types';
import { DisplayAuthError, displayApi, type DisplayIdentity } from './display-api';
import type { DeviceSession } from './device-session';

/**
 * A paired screen's live queue board.
 *
 * Same discipline as the staff hook: a realtime event only means "something
 * changed", and the board is then refetched over the device-authenticated
 * REST endpoint, which is what decides what this kind of screen may see. The
 * projection is chosen by the SERVER from the device's kind — the client
 * cannot ask for the richer one.
 *
 * A screen runs unattended, so it also refetches on a slow timer: if the
 * stream is dead and reconnection keeps failing, the board still catches up
 * rather than silently showing yesterday's numbers.
 */
const COALESCE_MS = 150;
const SAFETY_POLL_MS = 60_000;

export interface DisplayQueueState {
  identity: DisplayIdentity | null;
  customerBoard: QueueCustomerBoard | null;
  adminBoard: QueueAdminBoard | null;
  loading: boolean;
  error: string | null;
  /** True when the device credential was refused — the screen must be re-paired. */
  unpaired: boolean;
  stream: StreamStatus;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useDisplayQueue(session: DeviceSession | null): DisplayQueueState {
  const [identity, setIdentity] = useState<DisplayIdentity | null>(null);
  const [customerBoard, setCustomerBoard] = useState<QueueCustomerBoard | null>(null);
  const [adminBoard, setAdminBoard] = useState<QueueAdminBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unpaired, setUnpaired] = useState(false);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const kindRef = useRef<DisplayIdentity['kind'] | null>(null);
  const key = session ? session.credential.slice(0, 8) + session.branchId : '';
  const activeKey = useRef('');

  const refresh = useCallback(async () => {
    if (!session) return;
    const mine = session.credential.slice(0, 8) + session.branchId;
    try {
      let kind = kindRef.current;
      if (!kind) {
        const me = await displayApi.me(session);
        if (activeKey.current !== mine) return;
        kind = me.kind;
        kindRef.current = kind;
        setIdentity(me);
      }
      if (kind === 'QUEUE_ADMIN') {
        const board = await displayApi.adminBoard(session);
        if (activeKey.current !== mine) return;
        setAdminBoard(board);
      } else {
        const board = await displayApi.customerBoard(session);
        if (activeKey.current !== mine) return;
        setCustomerBoard(board);
      }
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
    kindRef.current = null;
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
      getTicket: async () => (await displayApi.streamTicket(session)).ticket,
      onStatus: (s) => {
        if (cancelled) return;
        setStream(s);
        if (s === 'open') reload();
      },
    });
    for (const type of QUEUE_EVENTS) client.on(type, reload);

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
    identity,
    customerBoard,
    adminBoard,
    loading: session !== null && customerBoard === null && adminBoard === null && error === null,
    error,
    unpaired,
    stream,
    updatedAt,
    refresh,
  };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api/client';
import { StreamClient, type StreamStatus } from '@/lib/realtime/sse-client';
import { tasksApi, type TaskContext, type TaskFilters } from './api';
import { TASK_EVENTS, type Task } from './types';

/**
 * The live task dashboard for a branch.
 *
 * Filtering happens SERVER-SIDE: the filters go into the query, and the
 * browser only ever holds the page it is showing. A realtime event is a signal
 * that something changed, never the new state — the list is refetched over
 * REST, which is authoritative and permission-checked, so a dropped, reordered
 * or missed-while-disconnected event resolves itself on the next fetch.
 */
const COALESCE_MS = 120;

export interface TaskBoardState {
  tasks: Task[];
  total: number;
  loading: boolean;
  error: string | null;
  stream: StreamStatus;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * `live` is false for a viewer who may only see their OWN tasks: the branch
 * stream carries everyone's task events, so the API refuses them a ticket.
 * Rather than dial a stream that can only be refused — which used to leave the
 * board saying "Reconnecting…" forever — such a board reads over REST alone
 * and reports its stream as closed.
 */
export function useTaskBoard(
  ctx: TaskContext | null,
  filters: TaskFilters,
  { live = true }: { live?: boolean } = {},
): TaskBoardState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamStatus>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const companyId = ctx?.companyId ?? null;
  const branchId = ctx?.branchId ?? null;
  const scope = useMemo(
    () => (companyId && branchId ? { companyId, branchId } : null),
    [companyId, branchId],
  );

  // Serialised so the effect re-runs when a filter genuinely changes.
  const filterKey = JSON.stringify(filters);
  const activeKey = useRef('');
  const key = `${scope ? `${scope.companyId}|${scope.branchId}` : ''}|${filterKey}`;

  const refresh = useCallback(async () => {
    if (!scope) return;
    const mine = `${scope.companyId}|${scope.branchId}|${filterKey}`;
    try {
      const page = await tasksApi.list(scope, JSON.parse(filterKey) as TaskFilters);
      if (activeKey.current !== mine) return;
      setTasks(page.data);
      setTotal(page.meta.total);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (activeKey.current !== mine) return;
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      if (activeKey.current === mine) setLoaded(true);
    }
  }, [scope, filterKey]);

  useEffect(() => {
    activeKey.current = key;
    if (!scope) return;

    if (!live) {
      let cancelled = false;
      void (async () => {
        await refresh();
        if (!cancelled) setStream('closed');
      })();
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    let coalesce: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      if (cancelled) return;
      if (coalesce) clearTimeout(coalesce);
      coalesce = setTimeout(() => void refresh(), COALESCE_MS);
    };

    const client = new StreamClient({
      streamUrl: `${apiBaseUrl()}/realtime/stream`,
      getTicket: async () => (await tasksApi.streamTicket(scope)).ticket,
      onStatus: (s) => {
        if (cancelled) return;
        setStream(s);
        if (s === 'open') reload();
      },
    });
    for (const type of TASK_EVENTS) client.on(type, reload);

    void (async () => {
      await refresh();
      if (!cancelled) void client.connect();
    })();

    return () => {
      cancelled = true;
      if (coalesce) clearTimeout(coalesce);
      client.close();
    };
  }, [scope, key, refresh, live]);

  return {
    tasks,
    total,
    loading: scope !== null && !loaded,
    error,
    stream,
    updatedAt,
    refresh,
  };
}

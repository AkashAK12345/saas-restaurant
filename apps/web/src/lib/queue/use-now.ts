'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, re-read every `intervalMs`.
 *
 * A live wait timer is computed HERE, from each token's join timestamp, rather
 * than pushed by the server: a server tick per party per minute would be a
 * broadcast storm for information every client can derive itself.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Whole minutes between an ISO timestamp and `now`; never negative. */
export function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

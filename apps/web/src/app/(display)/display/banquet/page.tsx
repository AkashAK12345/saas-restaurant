'use client';

import { useCallback, useEffect, useState } from 'react';
import { deviceSession, type DeviceSession } from '@/lib/display/device-session';
import { displayApi, type DisplayBranch } from '@/lib/display/display-api';
import { useDisplayBanquet } from '@/lib/display/use-display-banquet';
import { PairingForm } from '@/components/display/pairing-form';
import { ChefQueueBoard } from '@/components/display/chef-board';
import styles from '@/components/display/display.module.css';

/**
 * /display/banquet — the kitchen screen a paired BANQUET_CHEF device shows.
 *
 * The device authenticates with its own header credential and receives a
 * short-lived, single-use ticket for the `banquet-kds` stream; the projection
 * it gets is chosen server-side from its kind, so no URL can promote it. This
 * tree has no AuthProvider, no navigation and no staff session — the display
 * root layout provides none.
 *
 * Read-only: there is nothing here that can change a booking or an item.
 */
export default function BanquetDisplayPage() {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [ready, setReady] = useState(false);
  const [branch, setBranch] = useState<DisplayBranch | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = deviceSession.get();
      if (cancelled) return;
      setSession(stored);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kitchen = useDisplayBanquet(session);

  useEffect(() => {
    if (!session || kitchen.unpaired) return;
    let cancelled = false;
    void (async () => {
      try {
        const b = await displayApi.branch(session);
        if (!cancelled) setBranch(b);
      } catch {
        if (!cancelled) setBranch(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, kitchen.unpaired]);

  const pair = useCallback((next: DeviceSession) => {
    deviceSession.set(next);
    setSession(next);
  }, []);

  const unpair = useCallback(() => {
    deviceSession.clear();
    setSession(null);
    setBranch(null);
  }, []);

  if (!ready) {
    return (
      <p role="status" aria-live="polite">
        Starting…
      </p>
    );
  }

  if (!session || kitchen.unpaired) {
    return (
      <div>
        <PairingForm onPair={pair} error={kitchen.unpaired ? kitchen.error : null} />
        {session ? (
          <button type="button" className={styles.unpair} onClick={unpair} style={{ marginTop: 16 }}>
            Forget this device
          </button>
        ) : null}
      </div>
    );
  }

  if (kitchen.loading) {
    return (
      <p role="status" aria-live="polite">
        Loading the kitchen board…
      </p>
    );
  }

  if (kitchen.error && !kitchen.board) {
    return (
      <div role="alert" className={styles.pair}>
        <h1 className={styles.pairTitle}>Cannot reach the server</h1>
        <p className={styles.pairHint}>{kitchen.error} — retrying automatically.</p>
        <button type="button" className={styles.pairButton} onClick={() => void kitchen.refresh()}>
          Retry now
        </button>
      </div>
    );
  }

  if (!kitchen.board) return null;

  return (
    <ChefQueueBoard
      board={kitchen.board}
      branchName={branch?.name}
      stream={kitchen.stream}
      stale={kitchen.stream !== 'open'}
    />
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { deviceSession, type DeviceSession } from '@/lib/display/device-session';
import { displayApi, type DisplayBranch } from '@/lib/display/display-api';
import { useDisplayQueue } from '@/lib/display/use-display-queue';
import { PairingForm } from '@/components/display/pairing-form';
import { CustomerQueueBoard } from '@/components/display/customer-queue-board';
import { AdminQueueBoard } from '@/components/display/admin-queue-board';
import styles from '@/components/display/display.module.css';

/**
 * /display/queue — the screen a paired device shows.
 *
 * ONE ROUTE, TWO BOARDS, and the choice is the SERVER'S: GET
 * /display/queue/board returns the customer projection to a QUEUE_CUSTOMER
 * device and the operational one to a QUEUE_ADMIN device. A URL cannot
 * promote a screen, because the projection is decided from the authenticated
 * device row, never from the path.
 *
 * This tree has no AuthProvider, no navigation and no staff session — the
 * display root layout deliberately provides none — so there is nothing here
 * for a staff credential to attach to.
 */
export default function QueueDisplayPage() {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [ready, setReady] = useState(false);
  const [branch, setBranch] = useState<DisplayBranch | null>(null);

  // localStorage is only readable on the client; resolve after mount so the
  // page can be statically rendered.
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

  const queue = useDisplayQueue(session);

  useEffect(() => {
    if (!session || queue.unpaired) return;
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
  }, [session, queue.unpaired]);

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

  // Not paired, or the credential was refused (revoked, wrong branch, retyped).
  if (!session || queue.unpaired) {
    return (
      <div>
        <PairingForm onPair={pair} error={queue.unpaired ? queue.error : null} />
        {session ? (
          <button type="button" className={styles.unpair} onClick={unpair} style={{ marginTop: 16 }}>
            Forget this device
          </button>
        ) : null}
      </div>
    );
  }

  if (queue.loading) {
    return (
      <p role="status" aria-live="polite">
        Loading the queue…
      </p>
    );
  }

  // A transport error with nothing to show yet: say so plainly, keep retrying
  // in the background (the hook reconnects and polls).
  if (queue.error && !queue.customerBoard && !queue.adminBoard) {
    return (
      <div role="alert" className={styles.pair}>
        <h1 className={styles.pairTitle}>Cannot reach the server</h1>
        <p className={styles.pairHint}>{queue.error} — retrying automatically.</p>
        <button type="button" className={styles.pairButton} onClick={() => void queue.refresh()}>
          Retry now
        </button>
      </div>
    );
  }

  const stale = queue.stream !== 'open';

  if (queue.adminBoard) {
    return (
      <AdminQueueBoard
        board={queue.adminBoard}
        branchName={branch?.name}
        stream={queue.stream}
        stale={stale}
      />
    );
  }

  if (queue.customerBoard) {
    return (
      <CustomerQueueBoard
        board={queue.customerBoard}
        branchName={branch?.name}
        stream={queue.stream}
        stale={stale}
      />
    );
  }

  return null;
}

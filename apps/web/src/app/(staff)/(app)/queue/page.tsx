'use client';

import { useMemo } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { QueueTokenCard } from '@/components/queue/queue-token-card';
import { QueueStatusBar } from '@/components/queue/queue-status-bar';
import type { QueueToken } from '@/lib/queue/types';
import styles from '@/components/queue/queue.module.css';

/**
 * Queue Management — the whole service date at a glance: waiting, called and
 * seated, with the day's counts. Read-first; the podium screen is where a
 * shift is actually run.
 *
 * Live via SSE, reconciled over REST (see useQueueBoard).
 */
export default function QueuePage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const { board, loading, error, stream, updatedAt, refresh } = useQueueBoard(ctx);
  const actions = useQueueActions(ctx, refresh);

  const mayCancel = hasPermission(branchPermissions, 'queue.cancel');

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading the queue…
      </p>
    );
  }

  if (error && !board) {
    return (
      <div role="alert" className={styles.error}>
        <p>{error}</p>
        <button type="button" className={styles.action} onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }

  if (!board) return null;

  const column = (title: string, tokens: QueueToken[], emptyText: string) => (
    <div className={styles.column}>
      <div className={styles.columnHead}>
        <h2 className={styles.columnTitle}>{title}</h2>
        <span className={styles.count}>{tokens.length}</span>
      </div>
      {tokens.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {tokens.map((t) => (
            <QueueTokenCard
              key={t.id}
              token={t}
              busy={actions.busy}
              onCancel={mayCancel ? actions.cancel : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <h1>Queue</h1>

      <QueueStatusBar
        counts={board.counts}
        serviceDate={board.service_date}
        stream={stream}
        updatedAt={updatedAt}
        onRefresh={() => void refresh()}
        busy={actions.busy}
      />

      {actions.error ? (
        <div role="alert" className={styles.error}>
          {actions.error}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}

      {board.scheduled.length > 0 ? (
        <div style={{ marginBottom: 'var(--gap-lg)' }}>
          {column('Scheduled', board.scheduled, 'No advance bookings.')}
        </div>
      ) : null}

      <div className={`${styles.columns} ${styles.columnsThree}`}>
        {column('Waiting', board.waiting, 'Nobody is waiting.')}
        {column('Called', board.called, 'No party has been called.')}
        {column('Seated', board.seated, 'Nobody has been seated yet.')}
      </div>
    </>
  );
}

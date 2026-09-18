'use client';

import { useMemo } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { QueueTokenCard } from '@/components/queue/queue-token-card';
import { QueueStatusBar } from '@/components/queue/queue-status-bar';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import type { QueueToken } from '@/lib/queue/types';
import type { QueueTone } from '@/lib/queue/surfaces';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';

/**
 * Admin Display — Queue Management: the day's totals and every live party,
 * read-first. Cancelling is the only action here; the podium runs the shift.
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

  const header = <ScreenHeader crumb="Admin Display" title="Queue Management" />;

  if (loading) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <p role="status" aria-live="polite">
            Loading the queue…
          </p>
        </div>
      </>
    );
  }

  if (error && !board) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <div role="alert" className={chrome.alert}>
            <p>{error}</p>
            <button type="button" className={screens.button} onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!board) return header;

  const stats: Array<{ label: string; value: number; icon: AppIconName; tone: QueueTone }> = [
    { label: 'Total Waiting', value: board.totals.parties, icon: 'people', tone: 'blue' },
    { label: 'Total Adults', value: board.totals.adults, icon: 'person', tone: 'green' },
    { label: 'Total Kids', value: board.totals.kids, icon: 'kid', tone: 'amber' },
  ];
  const empty =
    board.scheduled.length + board.waiting.length + board.called.length + board.seated.length === 0;

  const section = (title: string, tokens: QueueToken[]) =>
    tokens.length === 0 ? null : (
      <section className={chrome.card} aria-labelledby={`queue-${title}`}>
        <div className={chrome.cardHead}>
          <h2 className={chrome.cardTitle} id={`queue-${title}`}>
            {title}
          </h2>
          <span className={chrome.countPill}>{tokens.length}</span>
        </div>
        <ul className={screens.list}>
          {tokens.map((t) => (
            <QueueTokenCard key={t.id} token={t} busy={actions.busy} onCancel={mayCancel ? actions.cancel : undefined} />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      {header}
      <div className={chrome.content}>
        <ul className={screens.stats} aria-label="Queue totals">
          {stats.map((s) => (
            <li key={s.label} className={screens.stat}>
              <span className={chrome.tile} data-tone={s.tone}>
                <AppIcon name={s.icon} size={28} />
              </span>
              <span className={screens.statValue}>{s.value}</span>
              <span className={screens.statLabel}>{s.label}</span>
            </li>
          ))}
        </ul>

        {actions.error ? (
          <p role="alert" className={chrome.alert}>
            {actions.error}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={chrome.alert}>
            {error}
          </p>
        ) : null}

        {empty ? (
          <section className={chrome.card}>
            <div className={chrome.empty}>
              <span className={chrome.emptyIcon}>
                <AppIcon name="emptyQueue" size={64} />
              </span>
              <h2 className={chrome.emptyTitle}>No customers yet</h2>
              <p className={chrome.emptyText}>The queue is currently empty</p>
            </div>
          </section>
        ) : (
          <>
            {section('Scheduled', board.scheduled)}
            {section('Waiting', board.waiting)}
            {section('Called', board.called)}
            {section('Seated', board.seated)}
          </>
        )}

        <QueueStatusBar
          counts={board.counts}
          serviceDate={board.service_date}
          stream={stream}
          updatedAt={updatedAt}
          onRefresh={() => void refresh()}
          busy={actions.busy}
        />
      </div>
    </>
  );
}

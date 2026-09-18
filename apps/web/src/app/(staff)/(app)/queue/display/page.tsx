'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';

const STREAM_TEXT = {
  idle: 'Connecting…',
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
} as const;

/**
 * Customer Display — the public queue screen, opened by signed-in staff on a
 * screen facing guests: who is being served and which numbers are waiting.
 *
 * NUMBERS AND TABLES ONLY. The staff board carries customer names; none is
 * rendered here, because the screen is read by the whole room. (A paired
 * wall screen uses /display/queue, which never receives a name at all.)
 */
export default function CustomerDisplayPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const mayView = hasPermission(branchPermissions, 'queue.view');
  const ctx = useMemo(
    () =>
      mayView && selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [mayView, selectedCompanyId, selectedBranchId],
  );
  const { board, loading, error, stream, refresh } = useQueueBoard(ctx);

  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen] = useState(
    () => typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function',
  );
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser refused (no user gesture, or not allowed): nothing changes.
    }
  };

  const header = (
    <ScreenHeader
      title="Customer Display"
      actions={
        canFullscreen ? (
          <button
            type="button"
            className={chrome.iconButton}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fullscreen}
            onClick={() => void toggleFullscreen()}
          >
            <AppIcon name="fullscreen" />
          </button>
        ) : null
      }
    />
  );

  if (!mayView) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <p role="alert" className={chrome.alert}>
            You do not have permission to view the queue at this branch.
          </p>
        </div>
      </>
    );
  }

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

  return (
    <>
      {header}
      <div className={chrome.content}>
        {error ? (
          <p role="alert" className={chrome.alert}>
            {error}
          </p>
        ) : null}

        <section className={chrome.card} aria-labelledby="now-serving">
          <div className={chrome.cardHead}>
            <span className={chrome.tile} data-tone="green">
              <AppIcon name="bell" size={26} />
            </span>
            <h2 className={screens.displayTitle} id="now-serving">
              Now Serving
            </h2>
            <span className={`${chrome.countPill} ${screens.pillGreen}`}>{board.called.length}</span>
          </div>
          {board.called.length === 0 ? (
            <div className={chrome.empty}>
              <p className={chrome.emptyText}>No customers being served</p>
            </div>
          ) : (
            <ul className={screens.serving}>
              {board.called.map((t) => (
                <li key={t.id} className={screens.servingItem} aria-label={`Token ${t.token_number}`}>
                  <span className={screens.servingNumber}>{t.token_number}</span>
                  <span className={screens.servingWhere}>
                    {t.assigned_table ? `Table ${t.assigned_table.label}` : 'Please come to the podium'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={chrome.card} aria-labelledby="waiting-tokens">
          <div className={chrome.cardHead}>
            <span className={chrome.tile} data-tone="amber">
              <AppIcon name="clock" size={26} />
            </span>
            <h2 className={screens.displayTitle} id="waiting-tokens">
              Waiting
            </h2>
            <span className={`${chrome.countPill} ${screens.pillAmber}`}>{board.waiting.length}</span>
          </div>
          {board.waiting.length === 0 ? (
            <div className={chrome.empty}>
              <p className={chrome.emptyText}>No customers waiting</p>
            </div>
          ) : (
            <ul className={screens.waitingTokens}>
              {board.waiting.map((t) => (
                <li key={t.id} className={screens.waitingToken}>
                  {t.token_number}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className={chrome.stream} role="status" aria-live="polite">
          {STREAM_TEXT[stream]}
          {stream !== 'open' ? (
            <button type="button" className={chrome.linkButton} onClick={() => void refresh()}>
              Refresh
            </button>
          ) : null}
        </p>
      </div>
    </>
  );
}

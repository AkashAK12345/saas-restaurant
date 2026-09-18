'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi } from '@/lib/queue/api';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { QueueTokenCard } from '@/components/queue/queue-token-card';
import { QueueStatusBar } from '@/components/queue/queue-status-bar';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import { NextTokenCard } from '@/components/queue/next-token-card';
import { RegisterForm } from '@/components/queue/register-form';
import type { QueueTableAvailability, QueueToken, RestaurantTable } from '@/lib/queue/types';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';
import styles from './podium.module.css';

type Tab = 'register' | 'call';

/**
 * Podium Operator: two tabs — Register a party, and Call Customers to run the
 * shift (call, seat with or without a table, skip, no-show, cancel, release).
 *
 * It reads the SAME queue tokens as every other surface — there is no podium
 * queue — and every action goes through an explicit backend operation, so an
 * illegal move is refused by the state machine rather than silently applied.
 * If another operator acts first, the API answers 409, the message is shown,
 * and the board is refetched.
 */
export default function PodiumPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions, companyPermissions } =
    useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const { board, loading, error, stream, updatedAt, refresh } = useQueueBoard(ctx);
  const actions = useQueueActions(ctx, refresh);
  const [tables, setTables] = useState<QueueTableAvailability[]>([]);

  const mayCall = hasPermission(branchPermissions, 'queue.call');
  const maySeat = hasPermission(branchPermissions, 'queue.seat');
  const mayNoShow = hasPermission(branchPermissions, 'queue.no_show');
  const mayCancel = hasPermission(branchPermissions, 'queue.cancel');
  const mayRegister = hasPermission(branchPermissions, 'queue.register');
  // Reading a phone number is customer data: both keys, and the API re-checks both.
  const mayContact = mayCall && hasPermission(companyPermissions, 'customers.view');
  const [tab, setTab] = useState<Tab>(mayRegister ? 'register' : 'call');
  const shownTab: Tab = mayRegister ? tab : 'call';

  // Occupancy comes from the API across EVERY service date — a party seated
  // before midnight still holds its table. Refetched whenever the board
  // changes, since seating and releasing are what change it.
  useEffect(() => {
    if (!ctx || !maySeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await queueApi.tableAvailability(ctx);
        if (!cancelled) setTables(rows);
      } catch {
        if (!cancelled) setTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, maySeat, updatedAt]);

  /**
   * Tables free right now: active, held by nobody on any day, and not taken
   * on the board since availability was last read. Seating still fails
   * cleanly if one is taken in the meantime.
   */
  const freeTables = useMemo<RestaurantTable[]>(() => {
    if (!board) return [];
    const taken = new Set(
      board.seated.map((t) => t.assigned_table_id).filter((id): id is string => id !== null),
    );
    return tables
      .filter((t) => t.status === 'ACTIVE' && t.occupied_by === null && !taken.has(t.id))
      .map((t) => ({ id: t.id, branch_id: board.branch_id, label: t.label, capacity: t.capacity, zone: t.zone, status: t.status }));
  }, [tables, board]);

  const loadContact = useMemo(
    () => (mayContact && ctx ? (t: QueueToken) => queueApi.contact(ctx, t.id) : undefined),
    [mayContact, ctx],
  );

  const header = <ScreenHeader title="Podium Operator" />;

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

  if (!board || !ctx) return header;

  const next = board.next_waiting;

  const column = (title: string, tokens: QueueToken[], emptyText: string, render: (t: QueueToken) => ReactNode) => (
    <section className={chrome.card} aria-labelledby={`podium-${title}`}>
      <div className={chrome.cardHead}>
        <h2 className={chrome.cardTitle} id={`podium-${title}`}>
          {title}
        </h2>
        <span className={chrome.countPill}>{tokens.length}</span>
      </div>
      {tokens.length === 0 ? <p className={screens.hint}>{emptyText}</p> : <ul className={screens.list}>{tokens.map(render)}</ul>}
    </section>
  );

  return (
    <>
      {header}
      <div className={chrome.content}>
        {mayRegister ? (
          <div className={screens.segmented} role="tablist" aria-label="Podium">
            <button
              type="button"
              role="tab"
              id="podium-tab-register"
              aria-selected={shownTab === 'register'}
              aria-controls="podium-panel"
              className={`${screens.segment} ${shownTab === 'register' ? screens.segmentActive : ''}`}
              onClick={() => setTab('register')}
            >
              <AppIcon name="personAdd" size={20} />
              Register
            </button>
            <button
              type="button"
              role="tab"
              id="podium-tab-call"
              aria-selected={shownTab === 'call'}
              aria-controls="podium-panel"
              className={`${screens.segment} ${shownTab === 'call' ? screens.segmentActive : ''}`}
              onClick={() => setTab('call')}
            >
              <AppIcon name="bell" size={20} />
              Call Customers
            </button>
          </div>
        ) : null}

        <div
          id="podium-panel"
          className={chrome.content}
          style={{ padding: 0 }}
          {...(mayRegister ? { role: 'tabpanel', 'aria-labelledby': `podium-tab-${shownTab}` } : {})}
        >
          {shownTab === 'register' ? (
            <>
              <NextTokenCard number={board.next_token_number} />
              <RegisterForm
                ctx={ctx}
                timezone={selectedBranch?.timezone ?? 'UTC'}
                allowAdvance
                submitLabel="Register Customer"
                onRegistered={() => void refresh()}
              />
            </>
          ) : (
            <>
              {actions.error ? (
                <p role="alert" className={chrome.alert}>
                  {actions.error}
                </p>
              ) : null}
              {actions.notice ? (
                <p role="status" aria-live="polite" className={chrome.notice}>
                  {actions.notice}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className={chrome.alert}>
                  {error}
                </p>
              ) : null}

              {next ? (
                <section className={styles.next} aria-label="Next party">
                  <div>
                    <span className={styles.nextLabel}>Next up</span>
                    <span className={styles.nextNumber}>{next.token_number}</span>
                  </div>
                  <div className={styles.nextWho}>
                    <strong>{next.customer?.name ?? 'Walk-in'}</strong>
                    <br />
                    {next.party_size} {next.party_size === 1 ? 'guest' : 'guests'}
                  </div>
                  {mayCall ? (
                    <button
                      type="button"
                      className={styles.nextAction}
                      disabled={actions.busy}
                      onClick={() => void actions.call(next)}
                    >
                      Call {next.token_number}
                    </button>
                  ) : null}
                </section>
              ) : (
                <p className={styles.idle}>Nobody is waiting.</p>
              )}

              <p className={styles.totals} aria-label="Waiting totals">
                <strong>{board.totals.parties}</strong> {board.totals.parties === 1 ? 'party' : 'parties'} waiting ·{' '}
                <strong>{board.totals.adults}</strong> adults · <strong>{board.totals.kids}</strong> kids
                {maySeat && tables.length > 0 ? (
                  <>
                    {' · '}
                    <strong>{freeTables.length}</strong> of {tables.filter((t) => t.status === 'ACTIVE').length} tables free
                  </>
                ) : null}
              </p>

              {maySeat && freeTables.length === 0 && tables.length > 0 ? (
                <p className={screens.hint}>Every table is occupied — seat parties without a table, or release one.</p>
              ) : null}

              {board.scheduled.length > 0
                ? column('Scheduled', board.scheduled, '', (t) => (
                    <QueueTokenCard
                      key={t.id}
                      token={t}
                      busy={actions.busy}
                      onCheckIn={mayRegister ? actions.checkIn : undefined}
                      onCancel={mayCancel ? actions.cancel : undefined}
                      loadContact={loadContact}
                    />
                  ))
                : null}

              {column('Called', board.called, 'Nobody has been called.', (t) => (
                <QueueTokenCard
                  key={t.id}
                  token={t}
                  tables={freeTables}
                  busy={actions.busy}
                  onSeat={maySeat ? actions.seat : undefined}
                  onSkip={mayCall ? actions.skip : undefined}
                  onNoShow={mayNoShow ? actions.noShow : undefined}
                  onCancel={mayCancel ? actions.cancel : undefined}
                  loadContact={loadContact}
                />
              ))}

              {column('Waiting', board.waiting, 'The waiting list is empty.', (t) => (
                <QueueTokenCard
                  key={t.id}
                  token={t}
                  busy={actions.busy}
                  highlight={t.id === next?.id}
                  onCall={mayCall ? actions.call : undefined}
                  onCancel={mayCancel ? actions.cancel : undefined}
                  loadContact={loadContact}
                />
              ))}

              {column('Seated', board.seated, 'Nobody has been seated yet.', (t) => (
                <QueueTokenCard
                  key={t.id}
                  token={t}
                  tables={freeTables}
                  busy={actions.busy}
                  onAssignTable={maySeat ? actions.assignTable : undefined}
                  onReleaseTable={maySeat ? actions.releaseTable : undefined}
                />
              ))}

              <QueueStatusBar
                counts={board.counts}
                serviceDate={board.service_date}
                stream={stream}
                updatedAt={updatedAt}
                onRefresh={() => void refresh()}
                busy={actions.busy}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

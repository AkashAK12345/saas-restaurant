'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi } from '@/lib/queue/api';
import { adminApi } from '@/lib/admin/api';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { useQueueActions } from '@/lib/queue/use-queue-actions';
import { ScreenHeader } from '@/components/app/screen-header';
import { AppIcon } from '@/components/app/icons';
import { formatTime } from '@/lib/format/datetime';
import type { QueueTableAvailability, QueueToken } from '@/lib/queue/types';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';

const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/**
 * Waiter — Table Management (SRS §5.2.4).
 *
 * The podium thinks in parties; a waiter thinks in tables. This screen adds a
 * table, shows which tables are available, seats the parties the podium has
 * called, and says "table cleared" when guests leave.
 *
 * Nothing here is a second source of truth: occupancy is the queue's seated
 * parties, and every action is the same explicit queue operation the podium
 * uses. Releasing a table publishes on the branch's queue stream, so the
 * podium sees it free up without anyone refreshing.
 */
export default function QueueTablesPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const { logout } = useAuth();
  const ctx = useMemo(
    () => (selectedCompanyId && selectedBranchId ? { companyId: selectedCompanyId, branchId: selectedBranchId } : null),
    [selectedCompanyId, selectedBranchId],
  );
  const maySeat = hasPermission(branchPermissions, 'queue.seat');
  const mayAddTable = hasPermission(branchPermissions, 'tables.create');

  const { board, loading, error, updatedAt, refresh } = useQueueBoard(maySeat ? ctx : null);
  const actions = useQueueActions(ctx, refresh);
  const [tables, setTables] = useState<QueueTableAvailability[] | null>(null);
  const [tablesVersion, setTablesVersion] = useState(0);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx || !maySeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await queueApi.tableAvailability(ctx);
        if (!cancelled) setTables(rows ?? []);
      } catch {
        if (!cancelled) setTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, maySeat, updatedAt, tablesVersion]);

  const header = (
    <ScreenHeader
      crumb="Waiter"
      title="Table Management"
      actions={
        <button type="button" className={chrome.iconButton} aria-label="Sign out" onClick={() => void logout()}>
          <AppIcon name="logout" />
        </button>
      }
    />
  );

  if (!maySeat || !ctx) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <p role="alert" className={chrome.alert}>
            You do not have permission to seat guests at this branch.
          </p>
        </div>
      </>
    );
  }

  if (loading || tables === null) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <p role="status" aria-live="polite">
            Loading tables…
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

  const tz = selectedBranch?.timezone;
  const seatedHere = new Map(
    board.seated.filter((t) => t.assigned_table_id).map((t) => [t.assigned_table_id as string, t]),
  );
  /**
   * Two different jobs, kept apart because they are not the same thing:
   *
   *   ready    the podium CALLED these parties, and seating them is the
   *            waiter move. A party that is merely waiting cannot be seated
   *            at all: the lifecycle is WAITING -> CALLED -> SEATED, so the
   *            podium has to call them first and the API refuses otherwise.
   *   noTable  already seated, but holding no table; they need one assigned.
   */
  const ready = board.called;
  const noTable = board.seated.filter((t) => !t.assigned_table_id);
  const active = tables.filter((t) => t.status === 'ACTIVE');
  const free = active.filter((t) => !t.occupied_by && !seatedHere.has(t.id));
  const occupied = active.filter((t) => t.occupied_by || seatedHere.has(t.id));
  const outOfService = tables.filter((t) => t.status !== 'ACTIVE');

  const addTable = async () => {
    const trimmed = label.trim();
    const seats = Number.parseInt(capacity, 10);
    setAddError(null);
    setAddNotice(null);
    if (!trimmed) return setAddError('Enter a table number.');
    if (!Number.isInteger(seats) || seats < 1) return setAddError('Enter how many guests the table seats.');
    setAdding(true);
    try {
      const created = await adminApi.createTable(ctx.companyId, ctx.branchId, { label: trimmed, capacity: seats });
      setAddNotice(`Table ${created.label} added.`);
      setLabel('');
      setCapacity('');
      setTablesVersion((v) => v + 1);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add the table');
    } finally {
      setAdding(false);
    }
  };

  /**
   * A list of parties with a table picker. `seat` moves a called party to
   * SEATED; `assign` gives a table to one already seated. Both go through the
   * same explicit queue operations the podium uses, and the API re-checks the
   * permission and the transition on every call.
   */
  const seatingSection = ({
    id,
    title,
    tokens,
    action,
    empty,
    footer,
  }: {
    id: string;
    title: string;
    tokens: QueueToken[];
    action: 'seat' | 'assign';
    empty: string;
    footer?: ReactNode;
  }) => (
    <section className={chrome.card} aria-labelledby={id}>
      <div className={chrome.cardHead}>
        <h2 className={chrome.cardTitle} id={id}>
          {title}
        </h2>
        <span className={chrome.countPill}>{tokens.length}</span>
      </div>
      {tokens.length === 0 ? (
        <div className={chrome.empty}>
          <p className={chrome.emptyText}>{empty}</p>
        </div>
      ) : (
        <ul className={screens.list} aria-label={title}>
          {tokens.map((token) => {
            const picked = choice[token.id] ?? '';
            const table = free.find((t) => t.id === picked);
            return (
              <li key={token.id} className={screens.row} aria-label={`Token ${token.token_number}`}>
                <span className={screens.tokenBadge}>{token.token_number}</span>
                <span className={screens.rowMain}>
                  <span className={screens.rowTitle}>{token.customer?.name ?? 'Walk-in'}</span>
                  <span className={screens.rowMeta}>
                    {guests(token.party_size)}
                    {action === 'seat' && token.called_at ? ` · called ${formatTime(token.called_at, tz)}` : ''}
                    {action === 'assign' && token.seated_at ? ` · seated ${formatTime(token.seated_at, tz)}` : ''}
                  </span>
                </span>
                <form
                  className={screens.rowActions}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!table) return;
                    void (async () => {
                      if (action === 'seat') await actions.seat(token, table.id);
                      else await actions.assignTable(token, table.id);
                      setChoice((c) => ({ ...c, [token.id]: '' }));
                    })();
                  }}
                >
                  <label className="sr-only" htmlFor={`seat-${token.id}`}>
                    Table for token {token.token_number}
                  </label>
                  <select
                    id={`seat-${token.id}`}
                    className={screens.select}
                    value={picked}
                    disabled={actions.busy || free.length === 0}
                    onChange={(e) => setChoice((c) => ({ ...c, [token.id]: e.target.value }))}
                  >
                    <option value="">{free.length === 0 ? 'No table free' : 'Choose a table'}</option>
                    {free.map((t) => (
                      <option key={t.id} value={t.id}>
                        Table {t.label} · {t.capacity} seats
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className={`${screens.button} ${screens.primary}`}
                    disabled={actions.busy || !table}
                  >
                    <AppIcon name="seat" size={20} />
                    {action === 'seat' ? 'Seat' : 'Assign table'}
                  </button>
                  {table && token.party_size > table.capacity ? (
                    <p className={screens.warn}>
                      A party of {token.party_size} is more than table {table.label}’s {table.capacity} seats.
                    </p>
                  ) : null}
                </form>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </section>
  );

  return (
    <>
      {header}
      <div className={chrome.content}>
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

        {mayAddTable ? (
          <section className={chrome.card} aria-labelledby="add-table">
            <div className={chrome.cardHead}>
              <h2 className={`${chrome.cardTitle} ${chrome.cardTitleAccent}`} id="add-table">
                Add New Table
              </h2>
            </div>
            <form
              className={screens.addRow}
              onSubmit={(e) => {
                e.preventDefault();
                void addTable();
              }}
            >
              <div className={screens.field}>
                <label className={screens.label} htmlFor="new-table-label">
                  Table Number
                </label>
                <input
                  id="new-table-label"
                  className={screens.input}
                  placeholder="e.g. T5"
                  value={label}
                  disabled={adding}
                  autoComplete="off"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className={screens.field}>
                <label className={screens.label} htmlFor="new-table-capacity">
                  Seating Capacity
                </label>
                <input
                  id="new-table-capacity"
                  className={screens.input}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="e.g. 4"
                  value={capacity}
                  disabled={adding}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </div>
              <button type="submit" className={`${screens.button} ${screens.primary}`} disabled={adding}>
                <AppIcon name="plus" size={20} />
                {adding ? 'Adding…' : 'Add'}
              </button>
            </form>
            {addError ? (
              <p role="alert" className={chrome.alert} style={{ marginTop: 12 }}>
                {addError}
              </p>
            ) : null}
            {addNotice ? (
              <p role="status" aria-live="polite" className={chrome.notice} style={{ marginTop: 12 }}>
                {addNotice}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className={chrome.card} aria-labelledby="available-tables">
          <div className={chrome.cardHead}>
            <h2 className={chrome.cardTitle} id="available-tables">
              Available Tables
            </h2>
            <span className={`${chrome.countPill} ${screens.pillGreen}`}>{free.length}</span>
          </div>
          {tables.length === 0 ? (
            <p className={screens.hint}>This branch has no tables yet.</p>
          ) : free.length === 0 ? (
            <p className={screens.hint}>Every table is occupied.</p>
          ) : (
            <ul className={screens.list} aria-label="Available tables">
              {free.map((t) => (
                <li key={t.id} className={screens.row} aria-label={`Table ${t.label}`}>
                  <span className={chrome.tile} data-tone="green">
                    <AppIcon name="table" size={26} />
                  </span>
                  <span className={screens.rowMain}>
                    <span className={screens.rowTitle}>Table {t.label}</span>
                    <span className={screens.rowMeta}>
                      {t.capacity} seats{t.zone ? ` · ${t.zone}` : ''}
                    </span>
                  </span>
                  <span className={`${screens.badge} ${screens.badgeFree}`}>Free</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {seatingSection({
          id: 'ready-to-seat',
          title: 'Ready to Seat',
          tokens: ready,
          action: 'seat',
          empty: 'Nobody has been called yet. The podium calls the next party.',
          footer:
            board.waiting.length > 0 ? (
              <p className={screens.hint} style={{ marginTop: 12 }}>
                {board.waiting.length} {board.waiting.length === 1 ? 'party is' : 'parties are'} waiting to be
                called at the podium.
              </p>
            ) : null,
        })}

        {/* Only when it happens: a party seated in a hurry, with no table yet. */}
        {noTable.length > 0
          ? seatingSection({
              id: 'seated-without-table',
              title: 'Seated Without a Table',
              tokens: noTable,
              action: 'assign',
              empty: '',
            })
          : null}

        <section className={chrome.card} aria-labelledby="occupied-tables">
          <div className={chrome.cardHead}>
            <h2 className={chrome.cardTitle} id="occupied-tables">
              Occupied Tables
            </h2>
            <span className={`${chrome.countPill} ${screens.pillAmber}`}>{occupied.length}</span>
          </div>
          {occupied.length === 0 ? (
            <p className={screens.hint}>No table is occupied.</p>
          ) : (
            <ul className={screens.list} aria-label="Occupied tables">
              {occupied.map((t) => {
                const today = seatedHere.get(t.id) ?? null;
                const heldEarlier = !today && t.occupied_by ? t.occupied_by : null;
                return (
                  <li key={t.id} className={screens.row} aria-label={`Table ${t.label}`}>
                    <span className={chrome.tile} data-tone="amber">
                      <AppIcon name="fork" size={24} />
                    </span>
                    <span className={screens.rowMain}>
                      <span className={screens.rowTitle}>Table {t.label}</span>
                      <span className={screens.rowMeta}>
                        {today
                          ? `Token ${today.token_number} · ${guests(today.party_size)}${today.seated_at ? ` · seated ${formatTime(today.seated_at, tz)}` : ''}`
                          : heldEarlier
                            ? `Token ${heldEarlier.token_number}, seated on an earlier service date`
                            : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={screens.button}
                      disabled={actions.busy}
                      onClick={() =>
                        void actions.releaseTable(today ?? ({ id: heldEarlier!.token_id } as QueueToken))
                      }
                    >
                      Table cleared
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {outOfService.length > 0 ? (
          <section className={chrome.card} aria-labelledby="out-of-service">
            <div className={chrome.cardHead}>
              <h2 className={chrome.cardTitle} id="out-of-service">
                Out of Service
              </h2>
              <span className={chrome.countPill}>{outOfService.length}</span>
            </div>
            <ul className={screens.list} aria-label="Out of service tables">
              {outOfService.map((t) => (
                <li key={t.id} className={screens.row} aria-label={`Table ${t.label}`}>
                  <span className={screens.rowMain}>
                    <span className={screens.rowTitle}>Table {t.label}</span>
                    <span className={screens.rowMeta}>{t.capacity} seats</span>
                  </span>
                  <span className={screens.badge}>Out of service</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

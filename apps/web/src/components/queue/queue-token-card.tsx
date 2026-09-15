'use client';

import { useState, type ReactNode } from 'react';
import {
  STATUS_LABEL,
  type QueueToken,
  type QueueTokenContact,
  type RestaurantTable,
} from '@/lib/queue/types';
import { minutesSince, useNow } from '@/lib/queue/use-now';
import styles from './queue.module.css';

const BADGE: Record<QueueToken['status'], string> = {
  SCHEDULED: styles.badgeScheduled,
  WAITING: styles.badgeWaiting,
  CALLED: styles.badgeCalled,
  SEATED: styles.badgeSeated,
  NO_SHOW: styles.badgeNoShow,
  CANCELLED: styles.badgeCancelled,
};

function clock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The most useful timestamp for the token's current state. */
function stamp(token: QueueToken, now: number): string {
  if (token.status === 'SCHEDULED') return `Booked for ${clock(token.advance_booking_at)}`;
  if (token.status === 'SEATED') return `Seated ${clock(token.seated_at)}`;
  if (token.status === 'CALLED') {
    const since = minutesSince(token.called_at, now);
    return `Called ${clock(token.called_at)}${since !== null ? ` · ${since} min ago` : ''}`;
  }
  if (token.status === 'NO_SHOW') return `No show ${clock(token.no_show_at)}`;
  if (token.status === 'CANCELLED') return `Cancelled ${clock(token.cancelled_at)}`;
  // Waiting: the live wait, counted from when the party joined.
  const waited = minutesSince(token.created_at, now);
  return `Joined ${clock(token.created_at)}${waited !== null ? ` · waiting ${waited} min` : ''}`;
}

export interface QueueActionsProps {
  token: QueueToken;
  tables?: RestaurantTable[];
  busy?: boolean;
  /** Each is omitted when the viewer lacks the permission for it. */
  onCall?: (token: QueueToken) => void;
  onSeat?: (token: QueueToken, tableId?: string) => void;
  onNoShow?: (token: QueueToken) => void;
  onCancel?: (token: QueueToken) => void;
  onAssignTable?: (token: QueueToken, tableId: string) => void;
  onReleaseTable?: (token: QueueToken) => void;
  onSkip?: (token: QueueToken) => void;
  onCheckIn?: (token: QueueToken) => void;
  /** Loads the party's phone on demand (queue.call + customers.view). */
  loadContact?: (token: QueueToken) => Promise<QueueTokenContact>;
}

/**
 * One party in the queue.
 *
 * Which buttons exist is driven by the STATE MACHINE (a waiting party can be
 * called or cancelled; a called one can be seated, skipped, no-showed or
 * cancelled; a scheduled one checked in) and by the permissions the parent
 * passes down. Hiding a button is a courtesy — the API re-checks both the
 * permission and the transition on every call.
 */
export function QueueTokenCard({
  token,
  tables = [],
  busy = false,
  highlight = false,
  onCall,
  onSeat,
  onNoShow,
  onCancel,
  onAssignTable,
  onReleaseTable,
  onSkip,
  onCheckIn,
  loadContact,
  children,
}: QueueActionsProps & { highlight?: boolean; children?: ReactNode }) {
  const [tableId, setTableId] = useState('');
  const [contact, setContact] = useState<QueueTokenContact | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const now = useNow();

  const free = tables.filter((t) => t.status === 'ACTIVE');
  const canSeatWithTable = token.status === 'CALLED' && onSeat;
  const canAssign = token.status === 'SEATED' && !token.assigned_table_id && onAssignTable;
  const live = token.status === 'SCHEDULED' || token.status === 'WAITING' || token.status === 'CALLED';

  const revealContact = async () => {
    if (!loadContact) return;
    setContactBusy(true);
    setContactError(null);
    try {
      setContact(await loadContact(token));
    } catch (e) {
      setContactError(e instanceof Error ? e.message : 'No contact number is available');
    } finally {
      setContactBusy(false);
    }
  };

  return (
    <li className={`${styles.card} ${highlight ? styles.cardHighlight : ''}`}>
      <div className={styles.cardTop}>
        <span className={styles.number} aria-label={`Token ${token.token_number}`}>
          {token.token_number}
        </span>
        <span className={styles.who}>
          <span className={styles.name}>{token.customer?.name ?? 'Walk-in'}</span>
          <span className={styles.meta}>
            {token.party_size} {token.party_size === 1 ? 'guest' : 'guests'}
            {token.kids > 0 ? ` (${token.adults}A · ${token.kids}K)` : ''} · {stamp(token, now)}
            {token.skip_count > 0 ? ` · skipped ${token.skip_count}×` : ''}
            {token.assigned_table ? (
              <>
                {' · '}
                <span className={styles.table}>Table {token.assigned_table.label}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className={`${styles.badge} ${BADGE[token.status]}`}>{STATUS_LABEL[token.status]}</span>
      </div>

      {(canSeatWithTable || canAssign) && free.length > 0 ? (
        <div className={styles.tableRow}>
          <label className="sr-only" htmlFor={`table-${token.id}`}>
            Table for token {token.token_number}
          </label>
          <select
            id={`table-${token.id}`}
            className={styles.select}
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            disabled={busy}
          >
            <option value="">No table</option>
            {free.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · seats {t.capacity}
              </option>
            ))}
          </select>
          {canAssign ? (
            <button
              type="button"
              className={styles.action}
              disabled={busy || !tableId}
              onClick={() => onAssignTable!(token, tableId)}
            >
              Assign table
            </button>
          ) : null}
        </div>
      ) : null}

      {contact ? (
        <div className={styles.contactRow} aria-label={`Contact for token ${token.token_number}`}>
          <a className={styles.action} href={contact.tel_url}>
            Phone {contact.phone}
          </a>
          {contact.whatsapp_url ? (
            <a className={styles.action} href={contact.whatsapp_url} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
      {contactError ? <p className={styles.meta}>{contactError}</p> : null}

      <div className={styles.actions}>
        {token.status === 'SCHEDULED' && onCheckIn ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            disabled={busy}
            onClick={() => onCheckIn(token)}
          >
            Check in
          </button>
        ) : null}

        {token.status === 'WAITING' && onCall ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            disabled={busy}
            onClick={() => onCall(token)}
          >
            Call
          </button>
        ) : null}

        {token.status === 'CALLED' && onSeat ? (
          <button
            type="button"
            className={`${styles.action} ${styles.primary}`}
            disabled={busy}
            onClick={() => onSeat(token, tableId || undefined)}
          >
            {tableId ? 'Seat at table' : 'Seat'}
          </button>
        ) : null}

        {token.status === 'CALLED' && onSkip ? (
          <button type="button" className={styles.action} disabled={busy} onClick={() => onSkip(token)}>
            Skip
          </button>
        ) : null}

        {token.status === 'CALLED' && onNoShow ? (
          <button type="button" className={styles.action} disabled={busy} onClick={() => onNoShow(token)}>
            No show
          </button>
        ) : null}

        {live && token.customer_id && loadContact && !contact ? (
          <button
            type="button"
            className={styles.action}
            disabled={busy || contactBusy}
            onClick={() => void revealContact()}
          >
            Contact
          </button>
        ) : null}

        {token.status === 'SEATED' && token.assigned_table_id && onReleaseTable ? (
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() => onReleaseTable(token)}
          >
            Release table
          </button>
        ) : null}

        {live && onCancel ? (
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            disabled={busy}
            onClick={() => onCancel(token)}
          >
            Cancel
          </button>
        ) : null}

        {children}
      </div>
    </li>
  );
}

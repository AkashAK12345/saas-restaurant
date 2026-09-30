import type { QueueTokenStatus } from '@samco/database';

/**
 * Projections of a queue token, ordered from most to least privileged. The
 * distinction is a security boundary, not a convenience: the `queue` realtime
 * channel is shared by staff clients AND display devices (T0-B scopes a
 * channel by company+branch, not by audience), so anything published there
 * must be safe for a screen hanging in a dining room.
 *
 *   QueueTokenView        REST only, behind queue.view. Carries the customer's
 *                         id and name.
 *   QueueTokenPublicView  Realtime payloads and every display projection.
 *                         Identical minus the customer object — a token
 *                         number, a party size and a table label are
 *                         operational facts; a customer's name is PII.
 *
 * Staff UIs therefore treat a realtime event as an authoritative summary plus
 * a signal to refetch names from REST when they need them.
 */
export interface QueueTokenPublicView {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string | null;
  service_date: string;
  token_number: number;
  status: QueueTokenStatus;
  adults: number;
  kids: number;
  party_size: number;
  /** Set when the guest asked for a later table rather than the live queue. */
  advance_booking_at: string | null;
  assigned_table_id: string | null;
  assigned_table: { id: string; label: string } | null;
  called_at: Date | null;
  seated_at: Date | null;
  /** When the seated party finished and left; null while still at the table. */
  finished_at: Date | null;
  cancelled_at: Date | null;
  no_show_at: Date | null;
  /** When a called party was last skipped back to the list; null if never. */
  skipped_at: Date | null;
  skip_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface QueueTokenView extends QueueTokenPublicView {
  customer: { id: string; name: string } | null;
}

export interface QueueCounts {
  scheduled: number;
  waiting: number;
  called: number;
  seated: number;
  no_show: number;
  cancelled: number;
}

/** Guests still waiting, split — what a host matches against free tables. */
export interface QueueWaitingTotals {
  parties: number;
  adults: number;
  kids: number;
}

/** A branch table and whether a seated party currently holds it (any day). */
export interface QueueTableAvailability {
  id: string;
  label: string;
  capacity: number;
  zone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  occupied_by: { token_id: string; token_number: number; service_date: string } | null;
}

/**
 * A waiting party's contact details, fetched on demand for a call or a
 * message. REST only, behind queue.call AND customers.view, and audited:
 * a phone number is never part of any board, broadcast or default view.
 */
export interface QueueTokenContactView {
  token_id: string;
  customer_name: string;
  phone: string;
  /** `tel:` link for a phone call. */
  tel_url: string;
  /**
   * `https://wa.me/…` link, only when the stored number carries an
   * international prefix — a local number cannot be turned into one safely.
   */
  whatsapp_url: string | null;
}

/**
 * The podium's working view of one service date: who is waiting, who has been
 * called, and which party to call next. `next_waiting` is simply the
 * lowest-numbered WAITING token — the queue is first-come, first-served and
 * the roadmap defines no other priority rule.
 */
export interface QueueBoard {
  branch_id: string;
  service_date: string;
  /**
   * The number the branch-day counter will hand out next. A preview only: a
   * concurrent registration can take it, and the number actually issued is
   * the one the register response returns.
   */
  next_token_number: number;
  counts: QueueCounts;
  totals: QueueWaitingTotals;
  next_waiting: QueueTokenView | null;
  /** Advance bookings not yet surfaced, soonest first. */
  scheduled: QueueTokenView[];
  waiting: QueueTokenView[];
  called: QueueTokenView[];
  seated: QueueTokenView[];
}

/** Admin display: the same operational picture, without customer names. */
export interface QueueAdminBoard {
  branch_id: string;
  service_date: string;
  counts: QueueCounts;
  totals: QueueWaitingTotals;
  waiting: QueueTokenPublicView[];
  called: QueueTokenPublicView[];
  seated: QueueTokenPublicView[];
}

/** What a public screen shows: numbers being served, and how many are waiting. */
export interface QueueDisplayEntry {
  token_number: number;
  table_label: string | null;
  called_at: Date | null;
}

export interface QueueCustomerBoard {
  branch_id: string;
  service_date: string;
  now_serving: QueueDisplayEntry[];
  recently_seated: QueueDisplayEntry[];
  waiting_count: number;
  /** Token numbers still waiting, in calling order. Numbers only. */
  waiting_tokens: number[];
}

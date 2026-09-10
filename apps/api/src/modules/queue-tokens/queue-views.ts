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
  cancelled_at: Date | null;
  no_show_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface QueueTokenView extends QueueTokenPublicView {
  customer: { id: string; name: string } | null;
}

export interface QueueCounts {
  waiting: number;
  called: number;
  seated: number;
  no_show: number;
  cancelled: number;
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
  counts: QueueCounts;
  next_waiting: QueueTokenView | null;
  waiting: QueueTokenView[];
  called: QueueTokenView[];
  seated: QueueTokenView[];
}

/** Admin display: the same operational picture, without customer names. */
export interface QueueAdminBoard {
  branch_id: string;
  service_date: string;
  counts: QueueCounts;
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
}

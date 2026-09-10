/**
 * Queue Management (Phase 7) response shapes.
 *
 * Hand-mirrored from apps/api/src/modules/queue-tokens, in the same way as
 * lib/api/types.ts — a generated contract package is backlog.
 *
 * Two projections exist on purpose, and the difference is a security
 * boundary, not a convenience:
 *   QueueToken        REST, behind queue.view — carries the customer name.
 *   QueueTokenPublic  every realtime payload and both display boards — no
 *                     customer identity, because the `queue` channel is
 *                     shared with screens hanging in the dining room.
 */

export type QueueTokenStatus = 'WAITING' | 'CALLED' | 'SEATED' | 'NO_SHOW' | 'CANCELLED';

export type QueueTokenEventType =
  | 'REGISTERED'
  | 'CALLED'
  | 'SEATED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'TABLE_ASSIGNED'
  | 'TABLE_RELEASED';

export interface QueueTokenPublic {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string | null;
  service_date: string;
  token_number: number;
  status: QueueTokenStatus;
  /** The party, split. `party_size` is the server-derived total of the two. */
  adults: number;
  kids: number;
  party_size: number;
  /** Set when the guest asked for a later table rather than the live queue. */
  advance_booking_at: string | null;
  assigned_table_id: string | null;
  assigned_table: { id: string; label: string } | null;
  called_at: string | null;
  seated_at: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueToken extends QueueTokenPublic {
  customer: { id: string; name: string } | null;
}

export interface QueueTokenHistoryEntry {
  id: string;
  event_type: QueueTokenEventType;
  previous_status: QueueTokenStatus | null;
  new_status: QueueTokenStatus;
  actor_user_id: string | null;
  metadata: { table_id?: string } | null;
  created_at: string;
}

export interface QueueTokenDetail extends QueueToken {
  events: QueueTokenHistoryEntry[];
}

export interface QueueCounts {
  waiting: number;
  called: number;
  seated: number;
  no_show: number;
  cancelled: number;
}

/** GET /queue-tokens/board — the podium's working view. */
export interface QueueBoard {
  branch_id: string;
  service_date: string;
  counts: QueueCounts;
  next_waiting: QueueToken | null;
  waiting: QueueToken[];
  called: QueueToken[];
  seated: QueueToken[];
}

/** GET /display/queue/board for a QUEUE_ADMIN device. */
export interface QueueAdminBoard {
  branch_id: string;
  service_date: string;
  counts: QueueCounts;
  waiting: QueueTokenPublic[];
  called: QueueTokenPublic[];
  seated: QueueTokenPublic[];
}

export interface QueueDisplayEntry {
  token_number: number;
  table_label: string | null;
  called_at: string | null;
}

/** GET /display/queue/board for a QUEUE_CUSTOMER device. */
export interface QueueCustomerBoard {
  branch_id: string;
  service_date: string;
  now_serving: QueueDisplayEntry[];
  recently_seated: QueueDisplayEntry[];
  waiting_count: number;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export interface Customer {
  id: string;
  company_id: string;
  name: string;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RestaurantTable {
  id: string;
  branch_id: string;
  label: string;
  capacity: number;
  zone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Realtime event names published on the `queue` channel. Every one carries a
 * QueueTokenPublic payload. Clients treat an event as a signal to reconcile
 * with the server rather than as the whole truth — see useQueueBoard.
 */
export const QUEUE_EVENTS = [
  'queue.token.registered',
  'queue.token.called',
  'queue.token.seated',
  'queue.token.no_show',
  'queue.token.cancelled',
  'queue.token.table_assigned',
  'queue.token.table_released',
] as const;

export type QueueEventName = (typeof QUEUE_EVENTS)[number];

/** Human labels, used by every queue surface. */
export const STATUS_LABEL: Record<QueueTokenStatus, string> = {
  WAITING: 'Waiting',
  CALLED: 'Called',
  SEATED: 'Seated',
  NO_SHOW: 'No show',
  CANCELLED: 'Cancelled',
};

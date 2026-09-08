import type {
  BanquetBookingStatus,
  BanquetHallStatus,
  BanquetKdsStatus,
  BanquetPackageStatus,
} from '@samco/database';

/**
 * Banquet projections, ordered from most to least privileged.
 *
 * The distinction is a security boundary, not a convenience: the `banquet-kds`
 * realtime channel is shared by staff clients AND the BANQUET_CHEF display
 * device (T0-B scopes a channel by company+branch, not by audience), so
 * anything published there — and anything a device can fetch — must be safe
 * for a screen on a kitchen wall.
 *
 *   BanquetBookingView  REST, behind banquet.view. Customer, money, notes.
 *   ChefBookingView     realtime payloads and the chef display. No customer
 *                       identity and NO MONEY AT ALL: a kitchen screen needs
 *                       to cook the food, not to know what it cost.
 */

export interface BanquetHallView {
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  status: BanquetHallStatus;
  created_at: Date;
  updated_at: Date;
}

export interface BanquetPackageItemView {
  id: string;
  name: string;
  position: number;
}

export interface BanquetPackageView {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  price_per_guest_minor: number;
  currency: string;
  status: BanquetPackageStatus;
  items: BanquetPackageItemView[];
  created_at: Date;
  updated_at: Date;
}

export interface BanquetBookingItemView {
  id: string;
  name: string;
  position: number;
  kds_status: BanquetKdsStatus;
  started_at: Date | null;
  ready_at: Date | null;
}

export interface BanquetPaymentView {
  id: string;
  booking_id: string;
  amount_minor: number;
  currency: string;
  paid_at: Date;
  method: string | null;
  reference: string | null;
  actor_user_id: string | null;
  created_at: Date;
}

/** Money summary. `balance_minor` is always derived, never stored. */
export interface BanquetBalanceView {
  currency: string;
  total_amount_minor: number;
  paid_minor: number;
  balance_minor: number;
  fully_paid: boolean;
}

export interface BanquetEventPlanView {
  id: string;
  booking_id: string;
  service_at: Date | null;
  setup_notes: string | null;
  kitchen_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BanquetBookingView {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  customer: { id: string; name: string } | null;
  hall_id: string;
  hall: { id: string; name: string; capacity: number } | null;
  package_id: string | null;
  starts_at: Date;
  ends_at: Date;
  guest_count: number;
  status: BanquetBookingStatus;
  package_name: string;
  price_per_guest_minor: number;
  currency: string;
  total_amount_minor: number;
  notes: string | null;
  confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BanquetBookingDetailView extends BanquetBookingView {
  items: BanquetBookingItemView[];
  payments: BanquetPaymentView[];
  balance: BanquetBalanceView;
  event_plan: BanquetEventPlanView | null;
}

/**
 * What a kitchen screen may see: which room, how many covers, when service is,
 * what to cook and how far along it is. No customer, no prices, no notes that
 * were written for the front of house.
 */
export interface ChefBookingView {
  id: string;
  branch_id: string;
  hall_name: string;
  guest_count: number;
  starts_at: Date;
  ends_at: Date;
  service_at: Date | null;
  kitchen_notes: string | null;
  status: BanquetBookingStatus;
  items: BanquetBookingItemView[];
}

export interface ChefBoardView {
  branch_id: string;
  /** Branch-local calendar date the board covers, e.g. "2026-09-07". */
  service_date: string;
  bookings: ChefBookingView[];
  counts: { events: number; pending: number; in_progress: number; ready: number };
}

/** The staff kitchen board: the chef view plus who the event is for. */
export interface StaffKdsBookingView extends ChefBookingView {
  customer_name: string | null;
}

export interface StaffKdsBoardView {
  branch_id: string;
  service_date: string;
  bookings: StaffKdsBookingView[];
  counts: { events: number; pending: number; in_progress: number; ready: number };
}

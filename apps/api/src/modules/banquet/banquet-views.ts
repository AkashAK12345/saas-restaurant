import type {
  BanquetAdjustmentKind,
  BanquetBookingStatus,
  BanquetHallStatus,
  BanquetKdsStatus,
  BanquetPackageStatus,
  BanquetPaymentKind,
} from '@samco/database';
import type { BanquetInvoice, BanquetPaymentStatusName } from './banquet-money.js';

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

export interface BanquetHallSlotView {
  id: string;
  hall_id: string;
  name: string;
  /** Branch-local HH:mm; an end at or before the start runs past midnight. */
  start_time: string;
  end_time: string;
  position: number;
  status: BanquetHallStatus;
}

export interface BanquetHallView {
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  status: BanquetHallStatus;
  slots: BanquetHallSlotView[];
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

export interface BanquetPaymentVerificationView {
  verified_by_user_id: string;
  verified_at: Date;
  note: string | null;
}

export interface BanquetPaymentView {
  id: string;
  booking_id: string;
  amount_minor: number;
  currency: string;
  paid_at: Date;
  method: string | null;
  reference: string | null;
  /** Server-decided settlement stage; null for payments recorded before stages existed. */
  kind: BanquetPaymentKind | null;
  actor_user_id: string | null;
  verification: BanquetPaymentVerificationView | null;
  created_at: Date;
}

export interface BanquetAdjustmentView {
  id: string;
  kind: BanquetAdjustmentKind;
  description: string;
  amount_minor: number;
  /** Set on a reversing line: the line it withdraws. */
  reverses_id: string | null;
  /** Set on a withdrawn line: the reversing line. */
  reversed_by_id: string | null;
  /** Priced into the bill: neither a reversal nor reversed. */
  active: boolean;
  actor_user_id: string | null;
  created_at: Date;
}

/** Money summary. */
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
  /** The hall's name as it was when booked or moved — renaming a hall never rewrites a booking. */
  hall_name: string;
  package_id: string | null;
  starts_at: Date;
  ends_at: Date;
  /** The guaranteed head count. */
  guest_count: number;
  extra_pax: number;
  status: BanquetBookingStatus;
  package_name: string;
  price_per_guest_minor: number;
  currency: string;
  gst_rate_bps: number;
  total_amount_minor: number;
  paid_minor: number;
  payment_status: BanquetPaymentStatusName;
  notes: string | null;
  cancellation_reason: string | null;
  confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BanquetBookingDetailView extends BanquetBookingView {
  items: BanquetBookingItemView[];
  payments: BanquetPaymentView[];
  adjustments: BanquetAdjustmentView[];
  invoice: BanquetInvoice;
  balance: BanquetBalanceView;
  event_plan: BanquetEventPlanView | null;
}

/** What a printed bill needs beyond the booking: who is billing. */
export interface BanquetBillView {
  booking: BanquetBookingDetailView;
  branch: {
    id: string;
    name: string;
    timezone: string;
    gstin: string | null;
    fssai_license: string | null;
    /** The branch's terms and conditions, printed at the foot of the bill. */
    banquet_terms: string | null;
  };
}

/**
 * What a kitchen screen may see: which room, how many plates, when service is,
 * what to cook and how far along it is. No customer, no prices, no notes that
 * were written for the front of house.
 */
export interface ChefBookingView {
  id: string;
  branch_id: string;
  hall_name: string;
  /** Plates to prepare: the guaranteed count plus any extra pax. */
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

/**
 * The staff kitchen board: the chef view plus who the event is for. The name
 * is only filled for a viewer who also holds banquet.view — kitchen staff with
 * banquet.kds.view alone get null, exactly like the wall screen.
 */
export interface StaffKdsBookingView extends ChefBookingView {
  customer_name: string | null;
}

export interface StaffKdsBoardView {
  branch_id: string;
  service_date: string;
  bookings: StaffKdsBookingView[];
  counts: { events: number; pending: number; in_progress: number; ready: number };
}

// ── Availability ─────────────────────────────────────────────────────────────

/**
 *   available  nothing overlaps
 *   tentative  only drafts overlap — nobody holds it yet
 *   booked     a confirmed or completed booking holds it
 */
export type SlotAvailability = 'available' | 'tentative' | 'booked';

/** Day state per hall: the reference system's Available / Partial / Fully booked. */
export type DayAvailability = 'available' | 'partial' | 'full';

export interface AvailabilitySlotView {
  slot_id: string;
  name: string;
  starts_at: Date;
  ends_at: Date;
  state: SlotAvailability;
  /** Overlapping booking ids only — the calendar links to them; no customer data. */
  booking_ids: string[];
}

export interface AvailabilityHallDayView {
  hall_id: string;
  hall_name: string;
  state: DayAvailability;
  slots: AvailabilitySlotView[];
  /** Confirmed/completed bookings overlapping that branch-local day (also covers halls with no slots). */
  confirmed_booking_ids: string[];
  draft_booking_ids: string[];
}

export interface AvailabilityDayView {
  date: string;
  halls: AvailabilityHallDayView[];
}

export interface AvailabilityView {
  branch_id: string;
  timezone: string;
  from: string;
  to: string;
  days: AvailabilityDayView[];
}

/**
 * Banquet (Phase 8) response shapes, hand-mirrored from
 * apps/api/src/modules/banquet — the same convention as lib/queue/types.ts.
 *
 * Two booking projections exist on purpose, and the difference is a security
 * boundary: `banquet-kds` is shared by staff clients and the BANQUET_CHEF
 * display, so ChefBooking — the realtime payload and the device board — has
 * no customer identity and no money at all.
 */

export type BanquetBookingStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type BanquetKdsStatus = 'PENDING' | 'IN_PROGRESS' | 'READY';
export type BanquetHallStatus = 'ACTIVE' | 'INACTIVE';
export type BanquetPackageStatus = 'ACTIVE' | 'INACTIVE';
export type BanquetAdjustmentKind = 'EXTRA_CHARGE' | 'LINE_DISCOUNT' | 'PER_HEAD_DISCOUNT' | 'ADMIN_DISCOUNT';
export type BanquetPaymentKind = 'ADVANCE' | 'INTERIM' | 'FINAL';
export type BanquetPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface BanquetHallSlot {
  id: string;
  hall_id: string;
  name: string;
  /** Branch-local HH:mm; an end at or before the start runs past midnight. */
  start_time: string;
  end_time: string;
  position: number;
  status: BanquetHallStatus;
}

export interface BanquetHall {
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  status: BanquetHallStatus;
  slots: BanquetHallSlot[];
  created_at: string;
  updated_at: string;
}

export interface BanquetPackageItem {
  id: string;
  name: string;
  position: number;
}

export interface BanquetPackage {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  price_per_guest_minor: number;
  currency: string;
  status: BanquetPackageStatus;
  items: BanquetPackageItem[];
  created_at: string;
  updated_at: string;
}

export interface BanquetBookingItem {
  id: string;
  name: string;
  position: number;
  kds_status: BanquetKdsStatus;
  started_at: string | null;
  ready_at: string | null;
}

export interface BanquetPayment {
  id: string;
  booking_id: string;
  amount_minor: number;
  currency: string;
  paid_at: string;
  method: string | null;
  reference: string | null;
  /** Decided by the server; null for payments recorded before stages existed. */
  kind: BanquetPaymentKind | null;
  actor_user_id: string | null;
  verification: { verified_by_user_id: string; verified_at: string; note: string | null } | null;
  created_at: string;
}

export interface BanquetAdjustment {
  id: string;
  kind: BanquetAdjustmentKind;
  description: string;
  amount_minor: number;
  reverses_id: string | null;
  reversed_by_id: string | null;
  /** Priced into the bill: neither a withdrawal nor withdrawn. */
  active: boolean;
  actor_user_id: string | null;
  created_at: string;
}

/** The layered bill, computed server-side. */
export interface BanquetInvoice {
  base_minor: number;
  extra_pax_minor: number;
  extra_charges_minor: number;
  gross_minor: number;
  line_discount_minor: number;
  per_head_discount_minor: number;
  admin_discount_minor: number;
  discount_minor: number;
  taxable_minor: number;
  gst_rate_bps: number;
  cgst_minor: number;
  sgst_minor: number;
  tax_minor: number;
  total_minor: number;
}

/** Always derived server-side from the total and the payment history. */
export interface BanquetBalance {
  currency: string;
  total_amount_minor: number;
  paid_minor: number;
  balance_minor: number;
  fully_paid: boolean;
}

export interface BanquetEventPlan {
  id: string;
  booking_id: string;
  service_at: string | null;
  setup_notes: string | null;
  kitchen_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BanquetBooking {
  id: string;
  company_id: string;
  branch_id: string;
  customer_id: string;
  customer: { id: string; name: string } | null;
  hall_id: string;
  hall: { id: string; name: string; capacity: number } | null;
  /** Snapshot: the hall's name when booked or moved. */
  hall_name: string;
  package_id: string | null;
  starts_at: string;
  ends_at: string;
  /** Guaranteed guests. */
  guest_count: number;
  extra_pax: number;
  status: BanquetBookingStatus;
  package_name: string;
  price_per_guest_minor: number;
  currency: string;
  gst_rate_bps: number;
  total_amount_minor: number;
  paid_minor: number;
  payment_status: BanquetPaymentStatus;
  notes: string | null;
  cancellation_reason: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BanquetBookingDetail extends BanquetBooking {
  items: BanquetBookingItem[];
  payments: BanquetPayment[];
  adjustments: BanquetAdjustment[];
  invoice: BanquetInvoice;
  balance: BanquetBalance;
  event_plan: BanquetEventPlan | null;
}

export interface BanquetBill {
  booking: BanquetBookingDetail;
  branch: {
    id: string;
    name: string;
    timezone: string;
    gstin: string | null;
    fssai_license: string | null;
    banquet_terms: string | null;
  };
}

/** The kitchen projection: no customer, no money. */
export interface ChefBooking {
  id: string;
  branch_id: string;
  hall_name: string;
  /** Plates to prepare: guaranteed guests plus extra pax. */
  guest_count: number;
  starts_at: string;
  ends_at: string;
  service_at: string | null;
  kitchen_notes: string | null;
  status: BanquetBookingStatus;
  items: BanquetBookingItem[];
}

export interface KdsCounts {
  events: number;
  pending: number;
  in_progress: number;
  ready: number;
}

export interface ChefBoard {
  branch_id: string;
  service_date: string;
  bookings: ChefBooking[];
  counts: KdsCounts;
}

export interface StaffKdsBooking extends ChefBooking {
  /** null unless the viewer also holds banquet.view. */
  customer_name: string | null;
}

export interface StaffKdsBoard {
  branch_id: string;
  service_date: string;
  bookings: StaffKdsBooking[];
  counts: KdsCounts;
}

// ── Availability ──────────────────────────────────────────────────────────────

export type SlotAvailability = 'available' | 'tentative' | 'booked';
export type DayAvailability = 'available' | 'partial' | 'full';

export interface AvailabilitySlot {
  slot_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  state: SlotAvailability;
  booking_ids: string[];
}

export interface AvailabilityHallDay {
  hall_id: string;
  hall_name: string;
  state: DayAvailability;
  slots: AvailabilitySlot[];
  confirmed_booking_ids: string[];
  draft_booking_ids: string[];
}

export interface Availability {
  branch_id: string;
  timezone: string;
  from: string;
  to: string;
  days: Array<{ date: string; halls: AvailabilityHallDay[] }>;
}

/** Realtime event names on the `banquet-kds` channel; payload is a ChefBooking. */
export const BANQUET_EVENTS = [
  'banquet.booking.confirmed',
  'banquet.booking.updated',
  'banquet.booking.cancelled',
  'banquet.booking.completed',
  'banquet.event_plan.updated',
  'banquet.item.updated',
  'banquet.plate_request.updated',
] as const;

// ── Plate approval ────────────────────────────────────────────────────────────

export type PlateRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED';

export const PLATE_STATUS_LABEL: Record<PlateRequestStatus, string> = {
  REQUESTED: 'Waiting for the kitchen',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DISPATCHED: 'Dispatched',
};

/** A request for plates of one dish. Kitchen-safe: no customer, no money. */
export interface PlateRequest {
  id: string;
  booking_id: string;
  hall_name: string | null;
  event_starts_at: string;
  item: { id: string; name: string };
  plates: number;
  note: string | null;
  status: PlateRequestStatus;
  requested_at: string;
  requested_by: { id: string; name: string };
  decided_at: string | null;
  decided_by: { id: string; name: string } | null;
  rejection_reason: string | null;
  dispatched_at: string | null;
  dispatched_by: { id: string; name: string } | null;
}

export const BOOKING_STATUS_LABEL: Record<BanquetBookingStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const KDS_STATUS_LABEL: Record<BanquetKdsStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'Cooking',
  READY: 'Ready',
};

export const ADJUSTMENT_LABEL: Record<BanquetAdjustmentKind, string> = {
  EXTRA_CHARGE: 'Extra charge',
  LINE_DISCOUNT: 'Line discount',
  PER_HEAD_DISCOUNT: 'Per-head discount',
  ADMIN_DISCOUNT: 'Admin discount',
};

/** Which permission adds or withdraws each kind — mirrors the API, which re-checks. */
export const ADJUSTMENT_PERMISSION: Record<BanquetAdjustmentKind, string> = {
  EXTRA_CHARGE: 'banquet.charge.manage',
  LINE_DISCOUNT: 'banquet.discount.apply',
  PER_HEAD_DISCOUNT: 'banquet.discount.apply',
  ADMIN_DISCOUNT: 'banquet.discount.admin',
};

export const PAYMENT_KIND_LABEL: Record<BanquetPaymentKind, string> = {
  ADVANCE: 'Advance',
  INTERIM: 'Interim',
  FINAL: 'Final',
};

export const PAYMENT_STATUS_LABEL: Record<BanquetPaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIAL: 'Part paid',
  PAID: 'Paid',
};

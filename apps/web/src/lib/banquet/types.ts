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

export interface BanquetHall {
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  status: BanquetHallStatus;
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
  actor_user_id: string | null;
  created_at: string;
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
  package_id: string | null;
  starts_at: string;
  ends_at: string;
  guest_count: number;
  status: BanquetBookingStatus;
  package_name: string;
  price_per_guest_minor: number;
  currency: string;
  total_amount_minor: number;
  notes: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BanquetBookingDetail extends BanquetBooking {
  items: BanquetBookingItem[];
  payments: BanquetPayment[];
  balance: BanquetBalance;
  event_plan: BanquetEventPlan | null;
}

/** The kitchen projection: no customer, no money. */
export interface ChefBooking {
  id: string;
  branch_id: string;
  hall_name: string;
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
  customer_name: string | null;
}

export interface StaffKdsBoard {
  branch_id: string;
  service_date: string;
  bookings: StaffKdsBooking[];
  counts: KdsCounts;
}

/** Realtime event names on the `banquet-kds` channel; payload is a ChefBooking. */
export const BANQUET_EVENTS = [
  'banquet.booking.confirmed',
  'banquet.booking.cancelled',
  'banquet.booking.completed',
  'banquet.event_plan.updated',
  'banquet.item.updated',
] as const;

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

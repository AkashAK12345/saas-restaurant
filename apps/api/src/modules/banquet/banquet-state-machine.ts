import { BanquetBookingStatus, BanquetKdsStatus } from '@samco/database';

/**
 * Banquet lifecycles — the single definition of which status changes are
 * legal. The services consult these before every mutation; nothing else
 * writes a status.
 *
 * BOOKING
 *
 *   DRAFT ─▶ CONFIRMED ─▶ COMPLETED
 *     └──────────┴──────▶ CANCELLED
 *
 * The roadmap names "Banquet Bookings" and "Advance & Balance" but does not
 * define a lifecycle, so this is the smallest one that supports the required
 * workflow, and the choice is documented rather than assumed:
 *
 *   DRAFT      an enquiry being priced. It holds no hall, so several drafts
 *              may exist for the same slot.
 *   CONFIRMED  the customer has committed. THIS is what claims the hall, and
 *              from here the kitchen can see the event.
 *   COMPLETED  the event has happened. Terminal; it keeps holding its slot so
 *              history stays truthful.
 *   CANCELLED  called off from either live state. Terminal, and it releases
 *              the hall immediately.
 *
 * There is no re-open transition: reviving a cancelled event would silently
 * re-claim a hall someone else may already have booked. A new booking is the
 * honest way to do that.
 */
export const BOOKING_TRANSITIONS: Readonly<
  Record<BanquetBookingStatus, readonly BanquetBookingStatus[]>
> = {
  [BanquetBookingStatus.DRAFT]: [
    BanquetBookingStatus.CONFIRMED,
    BanquetBookingStatus.CANCELLED,
  ],
  [BanquetBookingStatus.CONFIRMED]: [
    BanquetBookingStatus.COMPLETED,
    BanquetBookingStatus.CANCELLED,
  ],
  [BanquetBookingStatus.COMPLETED]: [],
  [BanquetBookingStatus.CANCELLED]: [],
};

export const INITIAL_BOOKING_STATUS = BanquetBookingStatus.DRAFT;

/**
 * The statuses that OCCUPY a hall, and therefore the ones the database
 * exclusion constraint applies to. Kept here beside the state machine so the
 * application rule and the SQL predicate can be read together — and asserted
 * against each other in the tests.
 *
 * See migration 20260907120000_phase8_banquet:
 *   WHERE (status IN ('CONFIRMED','COMPLETED'))
 */
export const HALL_OCCUPYING_STATUSES: readonly BanquetBookingStatus[] = [
  BanquetBookingStatus.CONFIRMED,
  BanquetBookingStatus.COMPLETED,
];

export function occupiesHall(status: BanquetBookingStatus): boolean {
  return HALL_OCCUPYING_STATUSES.includes(status);
}

/**
 * Details and price may change while a booking is live — a draft being quoted
 * or a confirmed event whose head count moves. A completed or cancelled
 * booking is history and closed. (Once an event has STARTED, the service
 * additionally requires banquet.booking.edit_past.)
 */
export function isEditable(status: BanquetBookingStatus): boolean {
  return status === BanquetBookingStatus.DRAFT || status === BanquetBookingStatus.CONFIRMED;
}

export function isTerminalBookingStatus(status: BanquetBookingStatus): boolean {
  return BOOKING_TRANSITIONS[status]?.length === 0;
}

export function canTransitionBooking(
  from: BanquetBookingStatus,
  to: BanquetBookingStatus,
): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * KDS ITEM
 *
 *   PENDING ─▶ IN_PROGRESS ─▶ READY
 *      └──────────────────────▶ READY
 *
 * A chef may mark a dish ready straight from PENDING (small items are simply
 * done), but nothing ever moves backwards: READY is terminal, so a finished
 * dish cannot be quietly un-finished on a shared kitchen screen.
 */
export const KDS_TRANSITIONS: Readonly<Record<BanquetKdsStatus, readonly BanquetKdsStatus[]>> = {
  [BanquetKdsStatus.PENDING]: [BanquetKdsStatus.IN_PROGRESS, BanquetKdsStatus.READY],
  [BanquetKdsStatus.IN_PROGRESS]: [BanquetKdsStatus.READY],
  [BanquetKdsStatus.READY]: [],
};

export function canTransitionKds(from: BanquetKdsStatus, to: BanquetKdsStatus): boolean {
  return KDS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Domain errors for illegal moves. NOT HTTP exceptions: the services translate
 * them into controlled 409s, so the state machines stay transport-agnostic.
 */
export class InvalidBookingTransitionError extends Error {
  constructor(
    readonly from: BanquetBookingStatus,
    readonly to: BanquetBookingStatus,
  ) {
    super(`Cannot move a banquet booking from ${from} to ${to}`);
    this.name = 'InvalidBookingTransitionError';
  }
}

export class InvalidKdsTransitionError extends Error {
  constructor(
    readonly from: BanquetKdsStatus,
    readonly to: BanquetKdsStatus,
  ) {
    super(`Cannot move a kitchen item from ${from} to ${to}`);
    this.name = 'InvalidKdsTransitionError';
  }
}

export function assertBookingTransition(
  from: BanquetBookingStatus,
  to: BanquetBookingStatus,
): void {
  if (!canTransitionBooking(from, to)) throw new InvalidBookingTransitionError(from, to);
}

export function assertKdsTransition(from: BanquetKdsStatus, to: BanquetKdsStatus): void {
  if (!canTransitionKds(from, to)) throw new InvalidKdsTransitionError(from, to);
}

/**
 * PLATE REQUEST (SRS §5.3.5 plate approval — portion control for service)
 *
 *   REQUESTED ─▶ APPROVED ─▶ DISPATCHED
 *       └──────▶ REJECTED
 *
 * Service staff ask for N plates of a dish; someone in the kitchen other than
 * the person who asked approves or rejects; approved plates are dispatched.
 * Nothing moves backwards and REJECTED / DISPATCHED are terminal, so a decision
 * on a shared kitchen screen cannot be quietly undone — a new request is the
 * honest way to ask again.
 */
export const PLATE_REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'DISPATCHED'] as const;
export type PlateRequestStatus = (typeof PLATE_REQUEST_STATUSES)[number];

export const PLATE_TRANSITIONS: Readonly<Record<PlateRequestStatus, readonly PlateRequestStatus[]>> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['DISPATCHED'],
  REJECTED: [],
  DISPATCHED: [],
};

export function canTransitionPlate(from: PlateRequestStatus, to: PlateRequestStatus): boolean {
  return PLATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidPlateTransitionError extends Error {
  constructor(
    readonly from: PlateRequestStatus,
    readonly to: PlateRequestStatus,
  ) {
    super(`Cannot move a plate request from ${from} to ${to}`);
    this.name = 'InvalidPlateTransitionError';
  }
}

export function assertPlateTransition(from: PlateRequestStatus, to: PlateRequestStatus): void {
  if (!canTransitionPlate(from, to)) throw new InvalidPlateTransitionError(from, to);
}

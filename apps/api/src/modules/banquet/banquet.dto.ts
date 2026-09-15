import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BanquetAdjustmentKind,
  BanquetBookingStatus,
  BanquetHallStatus,
  BanquetPackageStatus,
} from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { MAX_GUEST_COUNT, MAX_MINOR, MAX_PRICE_PER_GUEST_MINOR } from './banquet-money.js';

/**
 * Scope always comes from the guard-verified context headers, never from a
 * body: halls and bookings from X-Branch-ID, packages from X-Company-ID.
 * Nothing here accepts a status — lifecycle changes are explicit operations.
 */

/**
 * Names are trimmed before validation, so a name made only of spaces is empty
 * and refused by @IsNotEmpty — the staff screens already trim, but the API is
 * the boundary. (The global ValidationPipe runs with transform: true, so the
 * trimmed value is also what gets stored.)
 */
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ── Halls ───────────────────────────────────────────────────────────────────

export class CreateHallDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_GUEST_COUNT)
  capacity!: number;
}

export class UpdateHallDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GUEST_COUNT)
  capacity?: number;

  @IsOptional()
  @IsEnum(BanquetHallStatus)
  status?: BanquetHallStatus;
}

// ── Packages ────────────────────────────────────────────────────────────────

export class PackageItemDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;
}

export class CreatePackageDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Whole minor units (paise/cents), per guest. Never a decimal. */
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_PER_GUEST_MINOR)
  price_per_guest_minor!: number;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code, e.g. INR' })
  currency!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageItemDto)
  items?: PackageItemDto[];
}

export class UpdatePackageDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_PER_GUEST_MINOR)
  price_per_guest_minor?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code, e.g. INR' })
  currency?: string;

  @IsOptional()
  @IsEnum(BanquetPackageStatus)
  status?: BanquetPackageStatus;

  /** When given, replaces the component list wholesale. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PackageItemDto)
  items?: PackageItemDto[];
}

// ── Bookings ────────────────────────────────────────────────────────────────

export class CreateBookingDto {
  @IsUUID()
  customer_id!: string;

  @IsUUID()
  hall_id!: string;

  @IsUUID()
  package_id!: string;

  /** Absolute instants. An offset or Z is required so the meaning is unambiguous. */
  @IsISO8601({ strict: true })
  starts_at!: string;

  @IsISO8601({ strict: true })
  ends_at!: string;

  /** The guaranteed head count. */
  @IsInt()
  @Min(1)
  @Max(MAX_GUEST_COUNT)
  guest_count!: number;

  /** Guests over the guarantee, charged at the same per-plate rate. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GUEST_COUNT)
  extra_pax?: number;

  /**
   * Whether the branch's banquet GST rate applies (default true). false is
   * no-GST mode. The RATE is never client-supplied; it is the branch setting.
   */
  @IsOptional()
  @IsBoolean()
  apply_gst?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Edits to a DRAFT or CONFIRMED booking. Re-prices from the snapshot, never
 * from the live package. A booking whose event has started additionally needs
 * banquet.booking.edit_past; a completed or cancelled one is closed.
 */
export class UpdateBookingDto {
  @IsOptional()
  @IsUUID()
  hall_id?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  starts_at?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  ends_at?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GUEST_COUNT)
  guest_count?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GUEST_COUNT)
  extra_pax?: number;

  /**
   * true re-applies the branch's CURRENT banquet GST rate; false is no-GST
   * mode. The rate itself is never taken from the client.
   */
  @IsOptional()
  @IsBoolean()
  apply_gst?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export const BOOKING_TABS = ['drafts', 'upcoming', 'past', 'cancelled', 'all'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export const PAYMENT_FILTERS = ['pending', 'paid', 'unverified'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

/** Which date `from`/`to` are matched against. */
export const DATE_FIELDS = ['event', 'advance', 'final'] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export class ListBookingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BanquetBookingStatus)
  status?: BanquetBookingStatus;

  /**
   * drafts: DRAFT · upcoming: confirmed, not yet started · past: started and
   * not cancelled · cancelled · all. Combines with `status` by intersection.
   */
  @IsOptional()
  @IsIn(BOOKING_TABS)
  tab?: BookingTab;

  /** pending: live bookings still owing · paid: settled · unverified: has an unverified payment. */
  @IsOptional()
  @IsIn(PAYMENT_FILTERS)
  payment?: PaymentFilter;

  /** Inclusive lower/upper bounds on the chosen date (see date_field). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsIn(DATE_FIELDS)
  date_field?: DateField;

  @IsOptional()
  @IsUUID()
  hall_id?: string;

  /** Case-insensitive match on customer name, package name or hall name. */
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CancelBookingDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}

// ── Pricing adjustments ─────────────────────────────────────────────────────

export class CreateAdjustmentDto {
  @IsEnum(BanquetAdjustmentKind)
  kind!: BanquetAdjustmentKind;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string;

  /** Positive whole minor units; the kind decides the sign. Per plate for PER_HEAD_DISCOUNT. */
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amount_minor!: number;
}

// ── Hall slots ──────────────────────────────────────────────────────────────

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export class CreateHallSlotDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  /** Branch-local HH:mm. An end at or before the start runs past midnight. */
  @Matches(HHMM, { message: 'start_time must be HH:mm' })
  start_time!: string;

  @Matches(HHMM, { message: 'end_time must be HH:mm' })
  end_time!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  position?: number;
}

export class UpdateHallSlotDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'start_time must be HH:mm' })
  start_time?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'end_time must be HH:mm' })
  end_time?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  position?: number;

  @IsOptional()
  @IsEnum(BanquetHallStatus)
  status?: BanquetHallStatus;
}

/** Availability is asked for a branch-local date range, at most 62 days. */
export class AvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @IsOptional()
  @IsUUID()
  hall_id?: string;
}

// ── Payments ────────────────────────────────────────────────────────────────

export class CreatePaymentDto {
  @IsInt()
  @Min(1)
  amount_minor!: number;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code, e.g. INR' })
  currency!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  paid_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class VerifyPaymentDto {
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ── Event plan ──────────────────────────────────────────────────────────────

export class UpsertEventPlanDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  service_at?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  setup_notes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kitchen_notes?: string | null;
}

// ── KDS ─────────────────────────────────────────────────────────────────────

// ── Plate approval ──────────────────────────────────────────────────────────

/** Matches the banquet_plate_requests_plates_range CHECK. */
export const MAX_PLATES = 10_000;

export class CreatePlateRequestDto {
  /** A dish of THIS booking; checked against the booking in the service. */
  @IsUUID()
  item_id!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PLATES)
  plates!: number;

  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class RejectPlateRequestDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}

export class KdsBoardQueryDto {
  /** Branch-local calendar date; defaults to today at the branch. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'service_date must be YYYY-MM-DD' })
  service_date?: string;
}

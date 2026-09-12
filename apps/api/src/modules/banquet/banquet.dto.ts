import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
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
  BanquetBookingStatus,
  BanquetHallStatus,
  BanquetPackageStatus,
} from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { MAX_GUEST_COUNT, MAX_PRICE_PER_GUEST_MINOR } from './banquet-money.js';

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

  @IsInt()
  @Min(1)
  @Max(MAX_GUEST_COUNT)
  guest_count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Draft-only edits. Re-prices from the snapshot when the guest count changes. */
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
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class ListBookingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BanquetBookingStatus)
  status?: BanquetBookingStatus;

  /** Inclusive lower/upper bounds on starts_at. */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

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

export class KdsBoardQueryDto {
  /** Branch-local calendar date; defaults to today at the branch. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'service_date must be YYYY-MM-DD' })
  service_date?: string;
}

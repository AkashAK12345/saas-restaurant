import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { BranchStatus } from '@samco/database';
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone.validator.js';
import { MAX_GST_RATE_BPS } from '../banquet/banquet-money.js';

/** Matches the branches_banquet_terms_length CHECK in the database. */
export const BANQUET_TERMS_MAX_LENGTH = 4000;

/** Statutory ids are upper-case by definition; '' means "clear it". */
const upperTrimmed = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toUpperCase();
  return v === '' ? null : v;
};

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  /**
   * Must be a valid IANA timezone identifier.
   * Validated by the custom IsIanaTimezone decorator using Node's built-in Intl API.
   * Examples: 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'UTC'
   */
  @IsIanaTimezone()
  @IsString()
  @IsNotEmpty()
  timezone!: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIanaTimezone()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;

  /** GST registration printed on banquet bills. null clears it. */
  @IsOptional()
  @Transform(upperTrimmed)
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^[0-9]{2}[A-Z0-9]{13}$/, { message: 'gstin must be a 15-character GSTIN' })
  gstin?: string | null;

  /** FSSAI licence number printed on banquet bills. null clears it. */
  @IsOptional()
  @Transform(upperTrimmed)
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^[0-9]{14}$/, { message: 'fssai_license must be a 14-digit FSSAI licence number' })
  fssai_license?: string | null;

  /**
   * GST for NEW banquet bookings in basis points (500 = 5%). 0 is no-GST mode.
   * Existing bookings keep the rate they were made with.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_GST_RATE_BPS)
  banquet_gst_rate_bps?: number;

  /**
   * Terms and conditions printed on this branch's banquet bills and
   * quotations. Trimmed; '' or null clears them. The database enforces the
   * same 4000-character ceiling.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const v = value.trim();
    return v === '' ? null : v;
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(BANQUET_TERMS_MAX_LENGTH)
  banquet_terms?: string | null;

  // company_id is intentionally excluded.
  // Branch company ownership is immutable through normal update APIs.
  // Moving a branch between companies requires a separate administrative workflow.
}

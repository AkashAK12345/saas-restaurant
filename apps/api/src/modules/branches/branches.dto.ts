import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BranchStatus } from '@samco/database';
import { IsIanaTimezone } from '../../common/validators/is-iana-timezone.validator.js';

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

  // company_id is intentionally excluded.
  // Branch company ownership is immutable through normal update APIs.
  // Moving a branch between companies requires a separate administrative workflow.
}

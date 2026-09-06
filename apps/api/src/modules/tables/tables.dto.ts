import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TableStatus } from '@samco/database';

/**
 * Table is branch-scoped; the branch comes from the guard-verified
 * X-Branch-ID context, never from the body.
 */
export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  capacity!: number;

  // Free-text grouping only (e.g. "Terrace"). Floor is a Phase 2 entity.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  // Send null to clear.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zone?: string | null;

  @IsOptional()
  @IsEnum(TableStatus)
  status?: TableStatus;
}

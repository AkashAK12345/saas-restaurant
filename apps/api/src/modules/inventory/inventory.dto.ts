import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { STOCK_DEPARTMENTS } from '../tasks/reference-checklists.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The largest page of items the grid asks for at once. */
export const INVENTORY_MAX_PAGE = 200;

/**
 * The inventory grid's filters. Every one narrows the ITEMS; the branch also
 * narrows the columns and the summary, and the dates bound Consumed, Purchase
 * and the summary's period figures. No dates means all time.
 */
export class InventoryOverviewQueryDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsIn([...STOCK_DEPARTMENTS])
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INVENTORY_MAX_PAGE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

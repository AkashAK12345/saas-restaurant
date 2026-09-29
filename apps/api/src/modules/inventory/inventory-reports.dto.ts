import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A period: both dates or neither (neither is all time). */
class Period {
  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;
}

class Paged extends Period {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Monthly Avg Purchase: one item or all, one branch or all, a period. */
export class MonthlyAvgQueryDto extends Paged {
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

/** Comparative Purchase Analysis: Period A against Period B. */
export class ComparativeQueryDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @Matches(DATE, { message: 'a_from must be a date (YYYY-MM-DD)' })
  a_from!: string;

  @Matches(DATE, { message: 'a_to must be a date (YYYY-MM-DD)' })
  a_to!: string;

  @Matches(DATE, { message: 'b_from must be a date (YYYY-MM-DD)' })
  b_from!: string;

  @Matches(DATE, { message: 'b_to must be a date (YYYY-MM-DD)' })
  b_to!: string;
}

export const CONSOLIDATED_GROUPS = ['items', 'suppliers', 'branches'] as const;
export type ConsolidatedGroup = (typeof CONSOLIDATED_GROUPS)[number];

/** Head Outlet Consolidated: every branch's purchases, by item, supplier or branch. */
export class ConsolidatedQueryDto extends Period {
  @IsOptional()
  @IsIn(CONSOLIDATED_GROUPS)
  group?: ConsolidatedGroup;
}

/** Closing Stock Valuation: stock now, one branch or all. */
export class ClosingStockQueryDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Stock Transfers: sent from or to a branch, in a period. */
export class TransfersReportQueryDto extends Paged {
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Shared list pagination, matching the envelope already established by
 * GET /audit-logs: `limit` (1–100, default 50) / `offset`, returned as
 * `{ data, meta: { total, limit, offset } }`.
 *
 * Introduced for the T0-A list endpoints. The audit-logs DTO is left as-is
 * rather than refactored onto this class — Phase 1 code is not touched.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

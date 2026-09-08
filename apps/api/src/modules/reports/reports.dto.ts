import { BadRequestException } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';
import { EXPORT_FORMATS, type ExportFormat, isExportFormat } from './report-export.service.js';
import { REPORT_MAX_PAGE_SIZE } from './reports.service.js';

/**
 * Report query parameters.
 *
 * WHY THIS IS PARSED BY HAND rather than declared as a DTO.
 *
 * The API's global pipe runs with `forbidNonWhitelisted`, and a route-level
 * pipe runs IN ADDITION to it, not instead of it — so any DTO here would have
 * to name every filter any report may ever accept. That would make this file a
 * chokepoint: a future module registering a report with a `hall_id` filter
 * would be refused before the registry ever saw it, and "register a report
 * without touching the core" would be false.
 *
 * So the reserved parameters are validated explicitly below, and everything
 * else is treated as a report filter and checked against THAT REPORT'S OWN
 * allow-list in ReportsService. The result is stricter than a DTO, not looser:
 * a `@MaxLength(64) status` would have accepted any short string, whereas the
 * allow-list accepts only the values the report actually declared.
 *
 * `from`/`to` are BRANCH-LOCAL calendar dates. Only their SHAPE is checked
 * here; whether 2026-02-30 exists, and whether the range is ordered and within
 * the cap, belongs to report-range.ts, which owns that reasoning and its tests.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reserved names — every other query parameter is a report filter. */
export const RESERVED_QUERY_KEYS = ['from', 'to', 'limit', 'offset', 'format'] as const;

/** A filter value is a short scalar; nothing longer could be a legal option. */
export const MAX_OPTION_LENGTH = 64;

export interface ParsedReportQuery {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  options: Record<string, string>;
}

export interface ParsedExportQuery extends ParsedReportQuery {
  format: ExportFormat;
}

type RawQuery = Record<string, unknown>;

function asRaw(query: unknown): RawQuery {
  return query && typeof query === 'object' ? (query as RawQuery) : {};
}

/**
 * A reserved parameter that must be a single string if present.
 *
 * Repeated parameters (`?from=a&from=b`) arrive as an array and are REFUSED
 * rather than silently reduced to one value: quietly dropping half of what was
 * asked for would change the answer without saying so.
 */
function single(query: RawQuery, key: string): string | undefined {
  const value = query[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`"${key}" must be a single value`);
  }
  return value;
}

function date(query: RawQuery, key: 'from' | 'to'): string | undefined {
  const value = single(query, key);
  if (value === undefined) return undefined;
  if (!DATE.test(value)) {
    throw new BadRequestException(`${key} must be a branch-local date (YYYY-MM-DD)`);
  }
  return value;
}

function integer(query: RawQuery, key: string, min: number, max: number): number | undefined {
  const value = single(query, key);
  if (value === undefined) return undefined;
  // Reject "12abc" and "1e3": Number() is strict where parseInt is forgiving.
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${key} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

/** Every query parameter that is not reserved, i.e. the report's own filters. */
export function reportOptionsFrom(query: unknown): Record<string, string> {
  const raw = asRaw(query);
  const out: Record<string, string> = {};

  for (const key of Object.keys(raw)) {
    if ((RESERVED_QUERY_KEYS as readonly string[]).includes(key)) continue;
    const value = single(raw, key);
    if (value === undefined) continue;
    if (value.length > MAX_OPTION_LENGTH) {
      throw new BadRequestException(`Filter "${key}" is too long`);
    }
    out[key] = value;
  }
  return out;
}

export function parseReportQuery(query: unknown): ParsedReportQuery {
  const raw = asRaw(query);
  return {
    from: date(raw, 'from'),
    to: date(raw, 'to'),
    limit: integer(raw, 'limit', 1, REPORT_MAX_PAGE_SIZE),
    offset: integer(raw, 'offset', 0, Number.MAX_SAFE_INTEGER),
    options: reportOptionsFrom(raw),
  };
}

export function parseExportQuery(query: unknown): ParsedExportQuery {
  const raw = asRaw(query);
  const format = single(raw, 'format');
  if (!isExportFormat(format)) {
    throw new BadRequestException(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
  }
  const { limit: _limit, offset: _offset, ...rest } = parseReportQuery(raw);
  return { ...rest, format };
}

/**
 * The dashboard takes only a date window and has no per-report filters, so it
 * keeps an ordinary DTO and the global pipe's rejection of unknown parameters.
 */
export class ReportRangeQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'from must be a branch-local date (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be a branch-local date (YYYY-MM-DD)' })
  to?: string;
}

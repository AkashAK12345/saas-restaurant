import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  MAX_OPTION_LENGTH,
  RESERVED_QUERY_KEYS,
  parseExportQuery,
  parseReportQuery,
  reportOptionsFrom,
} from './reports.dto.js';
import { REPORT_MAX_PAGE_SIZE } from './reports.service.js';

/**
 * These parsers replaced a request DTO, so they carry the guarantees the DTO
 * used to: nothing reaches a provider unvalidated. They also carry the reason
 * the DTO had to go — a report's own filters must survive the pipeline
 * untouched by the core.
 */
describe('report query parsing', () => {
  describe('dates', () => {
    it('accepts a branch-local calendar date', () => {
      expect(parseReportQuery({ from: '2026-03-01', to: '2026-03-31' })).toMatchObject({
        from: '2026-03-01',
        to: '2026-03-31',
      });
    });

    it('treats an absent or empty date as unset, letting the server default', () => {
      expect(parseReportQuery({})).toMatchObject({ from: undefined, to: undefined });
      expect(parseReportQuery({ from: '' })).toMatchObject({ from: undefined });
    });

    it.each(['10-03-2026', '2026-3-1', 'yesterday', '2026-03-10T00:00:00Z', '2026/03/10'])(
      'rejects the malformed date %j',
      (from) => {
        expect(() => parseReportQuery({ from })).toThrow(BadRequestException);
      },
    );

    // Whether the day exists, and whether the range is ordered and inside the
    // cap, is report-range.ts's job — this only checks the shape.
    it('accepts a shape-valid but impossible date, leaving the calendar to the range', () => {
      expect(parseReportQuery({ from: '2026-02-30' }).from).toBe('2026-02-30');
    });
  });

  describe('paging', () => {
    it('accepts a limit and offset inside the bounds', () => {
      expect(parseReportQuery({ limit: '25', offset: '50' })).toMatchObject({
        limit: 25,
        offset: 50,
      });
    });

    it('rejects a limit beyond the page cap', () => {
      expect(() => parseReportQuery({ limit: String(REPORT_MAX_PAGE_SIZE + 1) })).toThrow(
        BadRequestException,
      );
    });

    it.each(['0', '-1', '1.5', '12abc', '1e3', 'many'])('rejects the limit %j', (limit) => {
      expect(() => parseReportQuery({ limit })).toThrow(BadRequestException);
    });

    it('rejects a negative offset', () => {
      expect(() => parseReportQuery({ offset: '-1' })).toThrow(BadRequestException);
    });
  });

  describe('filters', () => {
    it('treats every non-reserved parameter as a report filter', () => {
      expect(
        reportOptionsFrom({ from: '2026-03-01', limit: '10', status: 'SEATED', hall_id: 'main' }),
      ).toEqual({ status: 'SEATED', hall_id: 'main' });
    });

    it('passes through a filter key the core has never heard of', () => {
      // The whole extensibility claim in one assertion: nothing here knows
      // what a future report will want to filter on.
      expect(reportOptionsFrom({ some_future_module_filter: 'x' })).toEqual({
        some_future_module_filter: 'x',
      });
    });

    it.each(RESERVED_QUERY_KEYS)('never treats the reserved key %s as a filter', (key) => {
      expect(reportOptionsFrom({ [key]: 'value' })).toEqual({});
    });

    // Silently keeping one of two values would change which rows come back
    // without saying so.
    it('refuses a repeated parameter rather than picking one', () => {
      expect(() => reportOptionsFrom({ status: ['SEATED', 'NO_SHOW'] })).toThrow(
        /single value/i,
      );
      expect(() => parseReportQuery({ from: ['2026-03-01', '2026-04-01'] })).toThrow(
        /single value/i,
      );
    });

    it('refuses an over-long value instead of passing it to a query', () => {
      expect(() => reportOptionsFrom({ status: 'x'.repeat(MAX_OPTION_LENGTH + 1) })).toThrow(
        /too long/i,
      );
      expect(reportOptionsFrom({ status: 'x'.repeat(MAX_OPTION_LENGTH) })).toEqual({
        status: 'x'.repeat(MAX_OPTION_LENGTH),
      });
    });

    // The value is bound as a parameter downstream, but it should never have
    // been long enough to be interesting in the first place.
    it('carries a hostile value through unchanged, for the allow-list to refuse', () => {
      expect(reportOptionsFrom({ status: "SEATED'; DROP TABLE x; --" })).toEqual({
        status: "SEATED'; DROP TABLE x; --",
      });
    });

    it('survives a missing or non-object query', () => {
      expect(reportOptionsFrom(undefined)).toEqual({});
      expect(reportOptionsFrom('not a query')).toEqual({});
      expect(parseReportQuery(undefined).options).toEqual({});
    });
  });

  describe('export', () => {
    it.each(['xlsx', 'pdf'])('accepts the %s format', (format) => {
      expect(parseExportQuery({ format }).format).toBe(format);
    });

    it.each(['csv', 'XLSX', 'exe', '', undefined])('rejects the format %j', (format) => {
      expect(() => parseExportQuery(format === undefined ? {} : { format })).toThrow(
        BadRequestException,
      );
    });

    // An export applies the same filters as the screen, but never a page: a
    // file holding only page one would be worse than useless.
    it('carries the filters but never the paging', () => {
      const parsed = parseExportQuery({
        format: 'xlsx',
        from: '2026-03-01',
        status: 'SEATED',
        limit: '10',
        offset: '20',
      });

      expect(parsed).toEqual({
        format: 'xlsx',
        from: '2026-03-01',
        to: undefined,
        options: { status: 'SEATED' },
      });
    });
  });
});

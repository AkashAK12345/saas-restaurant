import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_REPORT_RANGE_DAYS,
  MAX_REPORT_RANGE_DAYS,
  eachLocalDate,
  isCalendarDate,
  resolveReportRange,
} from './report-range.js';

const KOLKATA = 'Asia/Kolkata'; // UTC+5:30, no DST
const NEW_YORK = 'America/New_York'; // DST

describe('report range', () => {
  describe('isCalendarDate', () => {
    it.each(['2026-09-01', '2024-02-29', '2026-12-31'])('accepts %s', (d) =>
      expect(isCalendarDate(d)).toBe(true),
    );
    it.each(['2026-9-1', '2026-02-30', '2026-13-01', 'today', '', '2026-09-01T00:00:00Z'])(
      'rejects %s',
      (d) => expect(isCalendarDate(d)).toBe(false),
    );
    it.each([[null], [undefined], [20260901], [{}]])('rejects the non-string %s', (d) =>
      expect(isCalendarDate(d)).toBe(false),
    );
  });

  describe('branch-local boundaries', () => {
    it('starts a Kolkata day at 18:30 UTC the previous evening', () => {
      const r = resolveReportRange(KOLKATA, '2026-09-01', '2026-09-01');
      expect(r.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
      // Half-open: the end is midnight at the start of the NEXT day.
      expect(r.to.toISOString()).toBe('2026-09-01T18:30:00.000Z');
      expect(r.days).toBe(1);
    });

    it('never treats a branch business date as a UTC calendar date', () => {
      const utc = resolveReportRange('UTC', '2026-09-01', '2026-09-08');
      const kolkata = resolveReportRange(KOLKATA, '2026-09-01', '2026-09-08');
      expect(utc.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(kolkata.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
      expect(kolkata.from.getTime()).toBeLessThan(utc.from.getTime());
    });

    it('covers a multi-day window inclusively', () => {
      const r = resolveReportRange(KOLKATA, '2026-09-01', '2026-09-08');
      expect(r.days).toBe(8);
      expect(r.fromLocal).toBe('2026-09-01');
      expect(r.toLocal).toBe('2026-09-08');
      expect(r.to.getTime() - r.from.getTime()).toBe(8 * 24 * 3_600_000);
    });

    it('defaults to the last 30 branch-local days ending today', () => {
      // 20:00 UTC on the 7th is already the 8th in Kolkata.
      const now = new Date('2026-09-07T20:00:00.000Z');
      const r = resolveReportRange(KOLKATA, undefined, undefined, now);
      expect(r.toLocal).toBe('2026-09-08');
      expect(r.days).toBe(DEFAULT_REPORT_RANGE_DAYS);
      expect(r.fromLocal).toBe('2026-08-10');
    });

    it('accepts a start with no end, ending today', () => {
      const now = new Date('2026-09-07T06:00:00.000Z');
      const r = resolveReportRange(KOLKATA, '2026-09-05', undefined, now);
      expect(r.fromLocal).toBe('2026-09-05');
      expect(r.toLocal).toBe('2026-09-07');
      expect(r.days).toBe(3);
    });
  });

  describe('DST', () => {
    it('a spring-forward day is 23 hours long, and still exactly one day', () => {
      // 14 Mar 2027, New York: 02:00 -> 03:00.
      const r = resolveReportRange(NEW_YORK, '2027-03-14', '2027-03-14');
      expect(r.days).toBe(1);
      expect(r.to.getTime() - r.from.getTime()).toBe(23 * 3_600_000);
      expect(r.from.toISOString()).toBe('2027-03-14T05:00:00.000Z'); // EST
      expect(r.to.toISOString()).toBe('2027-03-15T04:00:00.000Z'); // EDT
    });

    it('a fall-back day is 25 hours long, and still exactly one day', () => {
      // 7 Nov 2027, New York: 02:00 -> 01:00.
      const r = resolveReportRange(NEW_YORK, '2027-11-07', '2027-11-07');
      expect(r.days).toBe(1);
      expect(r.to.getTime() - r.from.getTime()).toBe(25 * 3_600_000);
      expect(r.from.toISOString()).toBe('2027-11-07T04:00:00.000Z'); // EDT
      expect(r.to.toISOString()).toBe('2027-11-08T05:00:00.000Z'); // EST
    });

    it('a window spanning a transition is not off by an hour at either end', () => {
      const r = resolveReportRange(NEW_YORK, '2027-03-10', '2027-03-20');
      expect(r.days).toBe(11);
      // 11 calendar days, one of which is 23 hours.
      expect(r.to.getTime() - r.from.getTime()).toBe(11 * 24 * 3_600_000 - 3_600_000);
      // Both boundaries are local midnight, at the offset in force that day.
      expect(r.from.toISOString()).toBe('2027-03-10T05:00:00.000Z');
      expect(r.to.toISOString()).toBe('2027-03-21T04:00:00.000Z');
    });

    it('day boundaries never overlap or leave a gap across a transition', () => {
      const a = resolveReportRange(NEW_YORK, '2027-11-06', '2027-11-06');
      const b = resolveReportRange(NEW_YORK, '2027-11-07', '2027-11-07');
      const c = resolveReportRange(NEW_YORK, '2027-11-08', '2027-11-08');
      expect(a.to.getTime()).toBe(b.from.getTime());
      expect(b.to.getTime()).toBe(c.from.getTime());
    });
  });

  describe('validation', () => {
    it.each([
      ['malformed from', '2026-9-1', '2026-09-08'],
      ['malformed to', '2026-09-01', 'soon'],
      ['impossible from', '2026-02-30', '2026-09-08'],
      ['impossible to', '2026-09-01', '2026-13-01'],
    ])('rejects %s', (_label, from, to) => {
      expect(() => resolveReportRange(KOLKATA, from, to)).toThrow(BadRequestException);
    });

    it('rejects a backwards range', () => {
      expect(() => resolveReportRange(KOLKATA, '2026-09-08', '2026-09-01')).toThrow(
        BadRequestException,
      );
    });

    it('accepts a range of exactly the maximum, and refuses one day more', () => {
      const ok = resolveReportRange(KOLKATA, '2026-01-01', '2027-01-01'); // 366 days
      expect(ok.days).toBe(MAX_REPORT_RANGE_DAYS);

      expect(() => resolveReportRange(KOLKATA, '2026-01-01', '2027-01-02')).toThrow(
        BadRequestException,
      );
      try {
        resolveReportRange(KOLKATA, '2020-01-01', '2027-01-02');
      } catch (e) {
        expect((e as Error).message).toMatch(/at most 366 days/);
      }
    });

    it('refuses an invalid timezone rather than falling back to the server zone', () => {
      expect(() => resolveReportRange('Mars/Olympus', '2026-09-01', '2026-09-01')).toThrow();
    });
  });

  describe('eachLocalDate', () => {
    it('lists every branch-local day in the window, oldest first', () => {
      const r = resolveReportRange(KOLKATA, '2026-08-30', '2026-09-02');
      expect(eachLocalDate(r)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
    });

    it('lists one day for a single-day window, including across DST', () => {
      expect(eachLocalDate(resolveReportRange(NEW_YORK, '2027-03-14', '2027-03-14'))).toEqual([
        '2027-03-14',
      ]);
    });
  });
});

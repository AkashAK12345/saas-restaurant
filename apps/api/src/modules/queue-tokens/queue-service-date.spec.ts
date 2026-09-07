import { describe, it, expect } from 'vitest';
import {
  currentServiceDate,
  isServiceDate,
  serviceDateFromDb,
  serviceDateToDb,
} from './queue-service-date.js';

describe('queue service date', () => {
  describe('isServiceDate', () => {
    it.each(['2026-09-07', '2026-01-01', '2026-12-31', '2024-02-29'])('accepts %s', (v) => {
      expect(isServiceDate(v)).toBe(true);
    });

    it.each([
      ['wrong shape', '2026-9-7'],
      ['not a date', 'today'],
      ['impossible day', '2026-02-30'],
      ['impossible month', '2026-13-01'],
      ['non-leap 29 Feb', '2026-02-29'],
      ['with time', '2026-09-07T00:00:00Z'],
      ['empty', ''],
    ])('rejects %s', (_label, v) => {
      expect(isServiceDate(v)).toBe(false);
    });

    it.each([[null], [undefined], [20260907], [{}], [['2026-09-07']]])(
      'rejects the non-string %s',
      (v) => {
        expect(isServiceDate(v)).toBe(false);
      },
    );
  });

  describe('db conversion', () => {
    it('stores a service date as UTC midnight, matching the DATE column', () => {
      expect(serviceDateToDb('2026-09-07').toISOString()).toBe('2026-09-07T00:00:00.000Z');
    });

    it('round-trips', () => {
      for (const d of ['2026-09-07', '2026-01-01', '2026-12-31']) {
        expect(serviceDateFromDb(serviceDateToDb(d))).toBe(d);
      }
    });
  });

  describe('currentServiceDate', () => {
    it('uses the BRANCH timezone, not the server UTC date', () => {
      // 18:30 UTC on the 7th is already 00:00 on the 8th in Kolkata (+05:30).
      const instant = new Date('2026-09-07T18:30:00.000Z');
      expect(currentServiceDate('UTC', instant)).toBe('2026-09-07');
      expect(currentServiceDate('Asia/Kolkata', instant)).toBe('2026-09-08');
      // ...and still the 7th in New York (-04:00).
      expect(currentServiceDate('America/New_York', instant)).toBe('2026-09-07');
    });

    it('keeps a late-evening registration on the branch-local day', () => {
      // 23:30 IST on the 7th = 18:00 UTC on the 7th.
      const instant = new Date('2026-09-07T18:00:00.000Z');
      expect(currentServiceDate('Asia/Kolkata', instant)).toBe('2026-09-07');
    });

    it('rolls a branch over its own midnight, not the server one', () => {
      const before = new Date('2026-09-07T18:29:59.000Z');
      const after = new Date('2026-09-07T18:30:01.000Z');
      expect(currentServiceDate('Asia/Kolkata', before)).toBe('2026-09-07');
      expect(currentServiceDate('Asia/Kolkata', after)).toBe('2026-09-08');
    });

    it('throws loudly on an invalid branch timezone rather than falling back', () => {
      expect(() => currentServiceDate('Mars/Olympus', new Date())).toThrow(RangeError);
    });

    it('produces a value that passes isServiceDate', () => {
      expect(isServiceDate(currentServiceDate('Asia/Kolkata'))).toBe(true);
    });
  });
});

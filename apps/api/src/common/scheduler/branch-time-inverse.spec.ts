import { describe, it, expect } from 'vitest';
import { branchLocalToInstant, toBranchLocal } from './branch-time.js';

/**
 * The inverse projection, exercised against real DST transitions.
 * America/New_York 2027: forward 14 Mar (02:00→03:00), back 7 Nov (02:00→01:00).
 */
describe('branchLocalToInstant', () => {
  it('is the exact inverse of toBranchLocal in a zone without DST', () => {
    const instant = branchLocalToInstant('2027-06-15', '09:00', 'Asia/Kolkata');
    // 09:00 IST == 03:30 UTC
    expect(instant.toISOString()).toBe('2027-06-15T03:30:00.000Z');
    const back = toBranchLocal(instant, 'Asia/Kolkata');
    expect([back.date, back.time]).toEqual(['2027-06-15', '09:00']);
  });

  it('round-trips across a whole year of dates and times', () => {
    for (const tz of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'UTC']) {
      for (const date of ['2027-01-15', '2027-04-01', '2027-07-04', '2027-10-31', '2027-12-25']) {
        for (const time of ['00:00', '06:30', '12:00', '18:45', '23:59']) {
          const parts = toBranchLocal(branchLocalToInstant(date, time, tz), tz);
          expect([tz, date, time, parts.date, parts.time]).toEqual([tz, date, time, date, time]);
        }
      }
    }
  });

  it('applies the offset in force on the day, not a fixed one', () => {
    // New York is UTC-5 in winter and UTC-4 in summer.
    expect(branchLocalToInstant('2027-01-15', '09:00', 'America/New_York').toISOString()).toBe(
      '2027-01-15T14:00:00.000Z',
    );
    expect(branchLocalToInstant('2027-07-15', '09:00', 'America/New_York').toISOString()).toBe(
      '2027-07-15T13:00:00.000Z',
    );
  });

  describe('DST — spring forward (02:00 → 03:00)', () => {
    it('a time before the gap is unaffected', () => {
      const i = branchLocalToInstant('2027-03-14', '01:30', 'America/New_York');
      expect(toBranchLocal(i, 'America/New_York').time).toBe('01:30');
      expect(i.toISOString()).toBe('2027-03-14T06:30:00.000Z');
    });

    it('a SKIPPED time resolves to the first real instant after the gap', () => {
      // 02:30 does not exist that day.
      const i = branchLocalToInstant('2027-03-14', '02:30', 'America/New_York');
      const parts = toBranchLocal(i, 'America/New_York');
      expect(parts.date).toBe('2027-03-14');
      // The routine still runs that day rather than vanishing.
      expect(parts.time >= '03:00').toBe(true);
      expect(parts.time < '04:00').toBe(true);
    });

    it('a time after the gap is unaffected', () => {
      const i = branchLocalToInstant('2027-03-14', '09:00', 'America/New_York');
      expect(toBranchLocal(i, 'America/New_York').time).toBe('09:00');
      expect(i.toISOString()).toBe('2027-03-14T13:00:00.000Z');
    });
  });

  describe('DST — fall back (02:00 → 01:00)', () => {
    it('a REPEATED time resolves to the first (earlier) occurrence', () => {
      // 01:30 happens twice on 7 Nov 2027: 05:30Z (EDT) and 06:30Z (EST).
      const i = branchLocalToInstant('2027-11-07', '01:30', 'America/New_York');
      expect(toBranchLocal(i, 'America/New_York').time).toBe('01:30');
      expect(i.toISOString()).toBe('2027-11-07T05:30:00.000Z');
    });

    it('the rest of that 25-hour day is still correct', () => {
      const i = branchLocalToInstant('2027-11-07', '09:00', 'America/New_York');
      expect(toBranchLocal(i, 'America/New_York').time).toBe('09:00');
      expect(i.toISOString()).toBe('2027-11-07T14:00:00.000Z');
    });
  });

  it('never uses the server timezone as a substitute', () => {
    // Whatever the host is set to, a UTC branch reads as UTC.
    expect(branchLocalToInstant('2027-05-05', '00:00', 'UTC').toISOString()).toBe(
      '2027-05-05T00:00:00.000Z',
    );
  });

  it.each([
    ['bad zone', '2027-01-01', '09:00', 'Mars/Olympus'],
    ['bad date', '01-01-2027', '09:00', 'UTC'],
    ['bad time', '2027-01-01', '9:00', 'UTC'],
    ['out of range time', '2027-01-01', '25:00', 'UTC'],
  ])('throws on %s rather than guessing', (_label, date, time, tz) => {
    expect(() => branchLocalToInstant(date, time, tz)).toThrow(RangeError);
  });
});

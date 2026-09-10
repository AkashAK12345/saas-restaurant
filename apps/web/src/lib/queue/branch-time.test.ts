import { describe, it, expect } from 'vitest';
import { branchLocalToInstant, instantToBranchLocal } from './branch-time';

/**
 * The whole point of this helper is that it does NOT use the device clock, so
 * every case below asserts an absolute instant that is true wherever the test
 * happens to run.
 */
describe('branchLocalToInstant', () => {
  it('reads a wall clock in the branch zone, not the device zone', () => {
    // 19:30 in Kolkata (UTC+5:30) is 14:00 UTC — regardless of where the
    // browser running this is.
    expect(branchLocalToInstant('2026-09-09T19:30', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-09-09T14:00:00.000Z',
    );
  });

  it.each([
    ['UTC', '2026-09-09T19:30', '2026-09-09T19:30:00.000Z'],
    ['Asia/Kolkata', '2026-01-01T00:00', '2025-12-31T18:30:00.000Z'],
    ['America/New_York', '2026-01-15T12:00', '2026-01-15T17:00:00.000Z'], // EST, UTC-5
    ['America/New_York', '2026-07-15T12:00', '2026-07-15T16:00:00.000Z'], // EDT, UTC-4
    ['Australia/Sydney', '2026-06-01T09:00', '2026-05-31T23:00:00.000Z'], // AEST, UTC+10
  ])('converts %s %s correctly', (zone, local, expected) => {
    expect(branchLocalToInstant(local, zone)?.toISOString()).toBe(expected);
  });

  // The hour after a spring-forward transition, where a naive single-pass
  // offset correction lands on the wrong side.
  it('survives a DST transition', () => {
    // New York springs forward at 2026-03-08 02:00 local. 03:00 local that day
    // is EDT (UTC-4), so 07:00 UTC.
    expect(branchLocalToInstant('2026-03-08T03:00', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:00:00.000Z',
    );
    // The evening before is still EST (UTC-5).
    expect(branchLocalToInstant('2026-03-07T20:00', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T01:00:00.000Z',
    );
  });

  it('accepts seconds but does not require them', () => {
    expect(branchLocalToInstant('2026-09-09T19:30:45', 'UTC')?.toISOString()).toBe(
      '2026-09-09T19:30:45.000Z',
    );
  });

  it.each(['', 'tomorrow', '2026-09-09', '09/09/2026 19:30', '2026-09-09T19', 'nonsense'])(
    'refuses the unusable value %j rather than guessing',
    (value) => {
      expect(branchLocalToInstant(value, 'UTC')).toBeNull();
    },
  );

  it('returns null for an unknown timezone instead of throwing', () => {
    expect(branchLocalToInstant('2026-09-09T19:30', 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('instantToBranchLocal', () => {
  it('renders an instant as the branch’s own wall clock', () => {
    expect(instantToBranchLocal(new Date('2026-09-09T14:00:00.000Z'), 'Asia/Kolkata')).toBe(
      '2026-09-09T19:30',
    );
  });

  it('round-trips with branchLocalToInstant', () => {
    for (const zone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Australia/Sydney']) {
      const local = '2026-07-04T18:45';
      const instant = branchLocalToInstant(local, zone);
      expect(instant).not.toBeNull();
      expect(instantToBranchLocal(instant!, zone)).toBe(local);
    }
  });

  it('uses a 24-hour clock, so midnight is 00 and not 24', () => {
    expect(instantToBranchLocal(new Date('2026-09-09T18:30:00.000Z'), 'Asia/Kolkata')).toBe(
      '2026-09-10T00:00',
    );
  });

  it('returns an empty string for an unknown timezone', () => {
    expect(instantToBranchLocal(new Date(), 'Mars/Olympus_Mons')).toBe('');
  });
});

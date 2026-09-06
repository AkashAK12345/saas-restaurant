import { describe, it, expect } from 'vitest';
import { toBranchLocal, branchLocalDate, isValidTimeZone } from './branch-time.js';

/**
 * The convention under test: a single UTC instant means a different calendar
 * date and wall-clock time in each branch, and jobs must reason in the
 * branch's zone — never the server's.
 */
describe('branch-time', () => {
  // 2026-03-15 20:30:00 UTC — late evening in Kolkata, afternoon in New York,
  // already the NEXT day in Auckland.
  const instant = new Date('2026-03-15T20:30:00.000Z');

  it('projects one instant into different branch dates and times', () => {
    expect(toBranchLocal(instant, 'UTC')).toMatchObject({ date: '2026-03-15', time: '20:30', weekday: 0 });
    expect(toBranchLocal(instant, 'Asia/Kolkata')).toMatchObject({ date: '2026-03-16', time: '02:00', hour: 2, minute: 0 });
    expect(toBranchLocal(instant, 'America/New_York')).toMatchObject({ date: '2026-03-15', time: '16:30' });
    expect(toBranchLocal(instant, 'Pacific/Auckland')).toMatchObject({ date: '2026-03-16', time: '09:30' });
  });

  it('the "service date" of the same moment differs across branches', () => {
    expect(branchLocalDate(instant, 'America/Los_Angeles')).toBe('2026-03-15');
    expect(branchLocalDate(instant, 'Asia/Kolkata')).toBe('2026-03-16');
  });

  it('uses a 24-hour clock with zero-padded fields', () => {
    const midnightish = new Date('2026-01-01T00:05:09.000Z');
    expect(toBranchLocal(midnightish, 'UTC')).toMatchObject({ time: '00:05', hour: 0, minute: 5, second: 9 });
    const noon = new Date('2026-01-01T12:00:00.000Z');
    expect(toBranchLocal(noon, 'UTC').time).toBe('12:00');
  });

  it('reports the weekday in the branch zone, not UTC', () => {
    // Saturday 23:30 UTC is already Sunday in Kolkata.
    const sat = new Date('2026-03-14T23:30:00.000Z');
    expect(toBranchLocal(sat, 'UTC').weekday).toBe(6);
    expect(toBranchLocal(sat, 'Asia/Kolkata').weekday).toBe(0);
  });

  it('handles a DST transition without throwing (US spring forward 2026-03-08)', () => {
    // 06:59 UTC = 01:59 EST; 07:00 UTC = 03:00 EDT (02:xx never exists).
    expect(toBranchLocal(new Date('2026-03-08T06:59:00.000Z'), 'America/New_York').time).toBe('01:59');
    expect(toBranchLocal(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York').time).toBe('03:00');
  });

  it('rejects an invalid timezone loudly rather than falling back to the server zone', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => toBranchLocal(instant, 'Mars/Olympus')).toThrow(RangeError);
  });
});

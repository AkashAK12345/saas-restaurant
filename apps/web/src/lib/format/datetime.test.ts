import { describe, it, expect } from 'vitest';
import {
  addCalendarDays,
  branchToday,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatTime,
  weekdayOf,
} from './datetime';

describe('en-IN, branch-zone formatting', () => {
  // 18:45Z on 15 March is 00:15 on 16 March in Kolkata.
  const instant = '2028-03-15T18:45:00.000Z';

  it('shows dd/MM/yyyy in the BRANCH zone, not the device zone', () => {
    expect(formatDate(instant, 'Asia/Kolkata')).toBe('16/03/2028');
    expect(formatDate(instant, 'UTC')).toBe('15/03/2028');
  });

  it('uses the Indian 12-hour clock', () => {
    expect(formatTime(instant, 'Asia/Kolkata')).toMatch(/^12:15\s?am$/i);
    expect(formatDateTime('2028-03-15T05:30:00.000Z', 'Asia/Kolkata')).toMatch(/^15\/03\/2028, 11:00\s?am$/i);
  });

  it('never blanks a screen on a missing value or an unknown zone', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime('not a date', 'Asia/Kolkata')).toBe('—');
    expect(formatDate(instant, 'Not/AZone')).toMatch(/^\d{2}\/\d{2}\/2028$/);
  });

  it('handles calendar labels without any zone arithmetic', () => {
    expect(formatCalendarDate('2028-03-05')).toBe('05/03/2028');
    expect(addCalendarDays('2028-02-28', 2)).toBe('2028-03-01'); // leap year
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(weekdayOf('2028-03-15')).toBe('Wed');
  });

  it("knows the branch's today even when the device is on another day", () => {
    const lateUtc = new Date('2028-03-15T20:00:00.000Z');
    expect(branchToday('Asia/Kolkata', lateUtc)).toBe('2028-03-16');
    expect(branchToday('America/New_York', lateUtc)).toBe('2028-03-15');
  });
});

import { describe, it, expect } from 'vitest';
import { dayLabel, instantLabel, isReported } from './eod.report-provider.js';

describe('EOD report helpers', () => {
  it('treats the ways staff write "nothing to report" as nothing', () => {
    for (const v of [null, undefined, '', '  ', 'NIL', 'nil', 'Nill', 'nil.', 'N/A', 'na', 'none', 'No', 'nothing', '-', '—', '0', 'no complaints', 'No issue']) {
      expect(isReported(v), JSON.stringify(v)).toBe(false);
    }
  });

  it('counts anything with substance as reported', () => {
    for (const v of ['B4 small piece of plastic found', 'fish is smelling', 'nil but AC water leaking', 'Late service at B10']) {
      expect(isReported(v), v).toBe(true);
    }
  });

  it('labels a branch-local day without moving it', () => {
    expect(dayLabel('2026-09-18')).toBe('18 Sep');
    expect(dayLabel('2026-01-01')).toBe('1 Jan');
  });

  it('labels an instant on the branch clock, across midnight', () => {
    expect(instantLabel(new Date('2026-09-18T18:18:00.000Z'), 'Asia/Kolkata')).toBe('18 Sep, 11:48 PM');
    expect(instantLabel(new Date('2026-09-19T18:56:00.000Z'), 'Asia/Kolkata')).toBe('20 Sep, 12:26 AM');
    expect(instantLabel(new Date('2026-09-19T18:56:00.000Z'), 'UTC')).toBe('19 Sep, 6:56 PM');
  });
});

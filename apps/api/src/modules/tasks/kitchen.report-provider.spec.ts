import { describe, it, expect } from 'vitest';
import { missedDatesLabel } from './checklist-report.js';
import { imagesLabel, isAffirmative, isNegative } from './kitchen.report-provider.js';

describe('Kitchen Checklist report helpers', () => {
  it('reads "yes" however it was typed as followed, and nothing else', () => {
    for (const v of ['yes', 'Yes', 'YES.', ' yes ', 'Yes, all labelled', 'done', 'ok']) {
      expect(isAffirmative(v), v).toBe(true);
    }
    for (const v of [null, undefined, '', 'N/A', 'no', 'not yet', 'yesterday only']) {
      expect(isAffirmative(v), String(v)).toBe(false);
    }
  });

  it('counts a "no" as a problem, but not "N/A" or a blank', () => {
    for (const v of ['no', 'No', 'No - drain blocked', 'not done', 'nope']) {
      expect(isNegative(v), v).toBe(true);
    }
    for (const v of [null, '', 'N/A', 'na', 'none', 'yes', 'noted']) {
      expect(isNegative(v), String(v)).toBe(false);
    }
  });

  it('labels the photo count', () => {
    expect(imagesLabel(21)).toBe('21 imgs');
    expect(imagesLabel(1)).toBe('1 img');
    expect(imagesLabel(0)).toBe('0 imgs');
  });

  it('spells out four missed dates, then "+N more"', () => {
    expect(missedDatesLabel([])).toBeNull();
    expect(missedDatesLabel(['2026-09-20', '2026-09-21'])).toBe('20 Sep, 21 Sep');
    expect(
      missedDatesLabel(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']),
    ).toBe('16 Sep, 17 Sep, 18 Sep, 19 Sep +3 more');
  });
});

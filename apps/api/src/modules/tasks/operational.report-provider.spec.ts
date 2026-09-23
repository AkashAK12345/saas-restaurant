import { describe, it, expect } from 'vitest';
import { displayAnswer, type ChecklistAnswer, type SubmittedForms } from './checklist-report.js';
import { averageRating } from './operational.report-provider.js';

const FIELD = 'Overall Rating for security (scale 1-5)';

function forms(ratings: Array<string | null | undefined>): SubmittedForms {
  const submissions = ratings.map((_, i) => ({
    task_id: `t${i}`,
    report_date: new Date('2026-09-18T00:00:00.000Z'),
    completed_at: new Date('2026-09-18T10:00:00.000Z'),
    submitted_by: null,
  }));
  const answers = new Map<string, Map<string, ChecklistAnswer>>();
  ratings.forEach((value, i) => {
    // undefined: the submission's form had no such field at all.
    if (value !== undefined) {
      answers.set(`t${i}`, new Map([[FIELD, { kind: 'RATING', value, is_done: value !== null }]]));
    }
  });
  return { submissions, labels: [FIELD], answers };
}

describe('Operational Checklist report helpers', () => {
  it('averages a rating over the submissions that gave it, to one decimal', () => {
    expect(averageRating(forms(['4', '5', '4']), FIELD)).toBe(4.3);
    // A skipped rating is not a zero.
    expect(averageRating(forms(['3', null, undefined]), FIELD)).toBe(3);
  });

  it('reads 0 when nothing was rated, as the reference screen does', () => {
    expect(averageRating(forms([]), FIELD)).toBe(0);
    expect(averageRating(forms([null]), FIELD)).toBe(0);
  });

  it('shows each kind of answer the way the log reads it', () => {
    expect(displayAnswer(undefined)).toBeNull();
    expect(displayAnswer({ kind: 'CHECK', value: null, is_done: true })).toBe('Yes');
    expect(displayAnswer({ kind: 'CHECK', value: null, is_done: false })).toBe('No');
    expect(displayAnswer({ kind: 'YES_NO', value: 'NO', is_done: true })).toBe('No');
    expect(displayAnswer({ kind: 'RATING', value: '4', is_done: true })).toBe('4/5');
    expect(displayAnswer({ kind: 'TEXT', value: '  ', is_done: false })).toBeNull();
    expect(displayAnswer({ kind: 'TEXT', value: 'Clean', is_done: true })).toBe('Clean');
  });
});

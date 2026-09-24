import { describe, it, expect } from 'vitest';
import type { ChecklistAnswer, SubmittedForms } from './checklist-report.js';
import { averageScore, scoreLabel, yesCount } from './bm.report-provider.js';

const FIELDS = ['A', 'B', 'C'];
const yesNo = (value: string | null): ChecklistAnswer => ({ kind: 'YES_NO', value, is_done: value !== null });

function forms(perTask: Array<Record<string, string | null>>): SubmittedForms {
  const submissions = perTask.map((_, i) => ({
    task_id: `t${i}`,
    report_date: new Date('2026-09-18T00:00:00.000Z'),
    completed_at: new Date('2026-09-18T06:00:00.000Z'),
    submitted_by: null,
  }));
  const answers = new Map(
    perTask.map((a, i) => [`t${i}`, new Map(Object.entries(a).map(([k, v]) => [k, yesNo(v)]))]),
  );
  return { submissions, labels: FIELDS, answers, items: new Map() };
}

describe('BM Checklist report helpers', () => {
  it('scores a submission by its Yes answers; No and unanswered are not Yes', () => {
    const answers = new Map([['A', yesNo('YES')], ['B', yesNo('NO')], ['C', yesNo(null)]]);
    expect(yesCount((f) => answers.get(f), FIELDS)).toBe(1);
    expect(scoreLabel(5, 6)).toBe('5/6');
  });

  it('averages a score over the period to one decimal, out of the question count', () => {
    expect(averageScore(forms([{ A: 'YES', B: 'YES', C: 'YES' }, { A: 'YES', B: 'NO', C: 'YES' }, { A: 'YES' }]), FIELDS)).toBe(
      '2/3',
    );
    expect(averageScore(forms([{ A: 'YES', B: 'YES' }, { A: 'YES', B: 'YES', C: 'YES' }]), FIELDS)).toBe('2.5/3');
    expect(averageScore(forms([]), FIELDS)).toBe('0/3');
  });
});

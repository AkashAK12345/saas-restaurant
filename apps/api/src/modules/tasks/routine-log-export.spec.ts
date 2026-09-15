import { describe, it, expect } from 'vitest';
import { routineLogReport } from './routine-log-export.js';
import type { RoutineLogView } from './tasks-views.js';

const log: RoutineLogView = {
  routine_id: 'r-1',
  routine_name: 'Opening checks',
  from: '2026-09-01',
  to: '2026-09-04',
  dates: ['2026-09-01', '2026-09-02', '2026-09-03'],
  occurrences: [
    { date: '2026-09-01', task_id: 't-1', status: 'COMPLETED', completed_at: new Date('2026-09-01T05:00:00Z'), late: false },
    { date: '2026-09-02', task_id: 't-2', status: 'COMPLETED', completed_at: new Date('2026-09-02T09:00:00Z'), late: true },
    { date: '2026-09-03', task_id: 't-3', status: 'PENDING', completed_at: null, late: false },
  ],
  rows: [
    { label: 'Meter reading', kind: 'NUMBER', cells: { '2026-09-01': { done: true, value: '100' }, '2026-09-02': { done: false, value: null } } },
    { label: 'Lights off', kind: 'CHECK', cells: { '2026-09-01': { done: true, value: null }, '2026-09-03': { done: false, value: null } } },
  ],
};

const branch = { id: 'b-1', name: 'Alpha Main', timezone: 'Asia/Kolkata' };

describe('routineLogReport', () => {
  const report = routineLogReport(log, branch, new Date('2026-09-04T06:00:00.000Z'));

  it('lays dates across as dd/MM/yyyy columns after the item column', () => {
    expect(report.columns.map((c) => c.label)).toEqual(['Item', '01/09/2026', '02/09/2026', '03/09/2026']);
    expect(report.columns.every((c) => c.type === 'string')).toBe(true);
  });

  it('says what became of each day, then each item’s answer, tick or gap — in plain text', () => {
    expect(report.rows).toEqual([
      { item: 'Task', '2026-09-01': 'Done', '2026-09-02': 'Done late', '2026-09-03': 'Not done' },
      { item: 'Meter reading', '2026-09-01': '100', '2026-09-02': 'No', '2026-09-03': '-' },
      { item: 'Lights off', '2026-09-01': 'Yes', '2026-09-02': '-', '2026-09-03': 'No' },
    ]);
    expect(JSON.stringify(report.rows)).not.toMatch(/[✓✗]/);
  });

  it('carries provenance and honest counts for the export header', () => {
    expect(report).toMatchObject({
      key: 'tasks.routine_log',
      name: 'Opening checks — compliance log',
      branch_name: 'Alpha Main',
      timezone: 'Asia/Kolkata',
      filters: { branch_id: 'b-1', from: '2026-09-01', to: '2026-09-04', options: {} },
      generated_at: '2026-09-04T06:00:00.000Z',
      meta: { total: 3, limit: 3, offset: 0 },
    });
    expect(Object.fromEntries(report.metrics.map((m) => [m.key, m.value]))).toEqual({ occurrences: 3, late: 1, not_done: 1 });
  });
});

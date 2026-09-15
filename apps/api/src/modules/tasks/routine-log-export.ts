import type { ReportResponse } from '../reports/report-contract.js';
import { indianDate } from '../reports/report-export.service.js';
import type { RoutineLogView } from './tasks-views.js';

/** Beyond this many date columns a PDF page stops being readable; Excel has no such limit. */
export const ROUTINE_LOG_PDF_MAX_DAYS = 14;

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

/**
 * The transposed compliance log in the shared report shape, so it is rendered
 * by the same Excel/PDF exporter as every report — same provenance header,
 * same branch name and dates, same limits.
 *
 * One column per occurrence date. The first row says what became of each
 * day's task (done, done late, not done, cancelled); every other row is a
 * checklist item: its answer, "Yes" / "No" for a tick, or "-" where that day's
 * checklist did not ask it. Plain text only — the PDF font has no ✓ or ✗.
 */
export function routineLogReport(
  log: RoutineLogView,
  branch: { id: string; name: string; timezone: string },
  generatedAt: Date,
): ReportResponse {
  const occurrence = new Map(log.occurrences.map((o) => [o.date, o]));

  const statusRow: Record<string, unknown> = { item: 'Task' };
  for (const date of log.dates) {
    const o = occurrence.get(date);
    statusRow[date] = !o ? '-' : o.status === 'COMPLETED' && o.late ? 'Done late' : (STATUS_LABEL[o.status] ?? 'Not done');
  }

  const itemRows = log.rows.map((row) => {
    const out: Record<string, unknown> = { item: row.label };
    for (const date of log.dates) {
      const cell = row.cells[date];
      out[date] = !cell ? '-' : (cell.value ?? (cell.done ? 'Yes' : 'No'));
    }
    return out;
  });

  const rows = [statusRow, ...itemRows];
  return {
    key: 'tasks.routine_log',
    name: `${log.routine_name} — compliance log`,
    description: 'Checklist items down the side, occurrence dates across. Yes = done, No = not done, - = not asked that day.',
    domain: 'tasks',
    kind: 'rows',
    generated_at: generatedAt.toISOString(),
    timezone: branch.timezone,
    branch_name: branch.name,
    filters: { branch_id: branch.id, from: log.from, to: log.to, options: {} },
    columns: [
      { key: 'item', label: 'Item', type: 'string' },
      ...log.dates.map((date) => ({ key: date, label: indianDate(date), type: 'string' as const })),
    ],
    drilldown: null,
    option_specs: [],
    exportable: true,
    metrics: [
      { key: 'occurrences', label: 'Occurrences', value: log.occurrences.length, type: 'number' },
      { key: 'late', label: 'Completed late', value: log.occurrences.filter((o) => o.late).length, type: 'number' },
      {
        key: 'not_done',
        label: 'Not completed',
        value: log.occurrences.filter((o) => o.status !== 'COMPLETED').length,
        type: 'number',
      },
    ],
    rows,
    meta: { total: rows.length, limit: rows.length, offset: 0 },
  };
}

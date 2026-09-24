import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toLocalDateString } from '../reports/report-values.js';
import {
  COMPLIANCE_COLUMNS,
  dayLabel,
  displayAnswer,
  exactSum,
  instantLabel,
  loadSubmissions,
  numberValue,
  referenceForm,
  runCompliance,
  type ChecklistAnswer,
} from './checklist-report.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * Biryani Sales reporting — each day's purchase and sales by weight, read
 * back. See checklist-report.ts for what counts as a submission.
 *
 * The form asks the same four figures (purchase, morning, evening, order
 * quantity, all in KG) once per product line: chicken and mutton biryani,
 * chicken and mutton mandi, appam. The log totals each figure across the
 * products; the per-product split opens from the row, as the form was filed.
 */

/** Log column -> the question it totals across every product. */
const FIGURES = {
  purchase_kg: { label: 'Purchase (KG)', field: 'Purchase (KG)' },
  morning_kg: { label: 'Morning (KG)', field: 'Morning (KG)' },
  evening_kg: { label: 'Evening (KG)', field: 'Evening (KG)' },
  order_qty_kg: { label: 'Order Qty (KG)', field: 'Order Qty (KG)' },
} as const;

const REMARKS = 'Remarks';

const BIRYANI_SALES = referenceForm('biryani-sales', [...Object.values(FIGURES).map((f) => f.field), REMARKS]);

type Item = ChecklistAnswer & { label: string };

/** One figure summed over every product line of a submission. */
export function figureTotal(items: readonly Item[], field: string): number {
  return exactSum(items.filter((i) => i.label === field).map(numberValue));
}

/** "12.5 KG" — a card's weight. */
export function kgLabel(kg: number): string {
  return `${kg} KG`;
}

@Injectable()
export class BiryaniSalesLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.biryani_sales',
    name: 'Biryani Sales',
    description: 'Every Biryani Sales Report submitted in the period, newest first, totalled across products.',
    domain: 'tasks',
    scope: 'branch',
    // A branch files one a day, so a period's log is short enough to send whole.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      ...Object.entries(FIGURES).map(([key, f]) => ({ key, label: f.label, type: 'number' as const })),
      { key: 'remarks', label: 'Remarks', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, BIRYANI_SALES.name);
    // Newest first, as the screen lists them.
    const rows = [...forms.submissions].reverse().map((s) => {
      const items = forms.items.get(s.task_id) ?? [];
      return {
        task_id: s.task_id,
        date: dayLabel(toLocalDateString(s.report_date), true),
        submitted_by: s.submitted_by,
        ...Object.fromEntries(Object.entries(FIGURES).map(([key, f]) => [key, figureTotal(items, f.field)])),
        remarks: displayAnswer(items.find((i) => i.label === REMARKS)),
        submitted_at: instantLabel(s.completed_at, query.ctx.timezone),
      };
    });

    const period = (key: keyof typeof FIGURES) =>
      exactSum(rows.map((r) => (r as Record<string, unknown>)[key] as number));
    return {
      rows,
      total: rows.length,
      metrics: [
        { key: 'total_reports', label: 'Total Reports', value: rows.length, type: 'number' },
        { key: 'purchase', label: 'Purchase', value: kgLabel(period('purchase_kg')), type: 'string' },
        { key: 'morning_sales', label: 'Morning Sales', value: kgLabel(period('morning_kg')), type: 'string' },
        { key: 'evening_sales', label: 'Evening Sales', value: kgLabel(period('evening_kg')), type: 'string' },
        // Not a card on screen; kept for the export.
        { key: 'order_qty', label: 'Order Qty', value: kgLabel(period('order_qty_kg')), type: 'string' },
      ],
    };
  }
}

/** Whether the Biryani Sales Report was filed each day, per person responsible. */
@Injectable()
export class BiryaniSalesComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.biryani_sales_compliance',
    name: 'Biryani Sales Submission Compliance',
    description: 'Whether the Biryani Sales Report was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, BIRYANI_SALES.name);
  }
}

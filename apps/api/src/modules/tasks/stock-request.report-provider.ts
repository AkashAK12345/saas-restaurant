import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toLocalDateString } from '../reports/report-values.js';
import {
  COMPLIANCE_COLUMNS,
  dayLabel,
  instantLabel,
  loadSubmissions,
  referenceForm,
  runCompliance,
  type ChecklistAnswer,
} from './checklist-report.js';
import { STOCK_DEPARTMENTS } from './reference-checklists.js';
import type { ReportDefinition, ReportProvider, ReportQuery, ReportResult } from '../reports/report-contract.js';

/**
 * Kitchen Stock Request reporting — each kitchen's daily indent, read back.
 * See checklist-report.ts for what counts as a submission.
 *
 * The form has one "Items requested" box per department, so one request can
 * ask on behalf of several. The log has a row per department asked for — a
 * request for Indian and BBQ is two rows — and the Department filter keeps
 * the ones it names. A request filed on the form before it was split has no
 * departments; it reads as "Legacy".
 */

const ITEMS = 'Items requested';
const NEEDED_BY = 'Needed by';
export const LEGACY = 'Legacy';

const STOCK_REQUEST = referenceForm('kitchen-stock-request', [ITEMS, NEEDED_BY]);

/**
 * How many items a request lists: one per line, or per comma or semicolon
 * when it was typed on one line. "Rice 10kg, Oil 5L" is two.
 */
export function itemCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text
    .split(/\r?\n|[,;]/)
    .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean).length;
}

type Item = ChecklistAnswer & { label: string };

/** A request's departments with what each asked for, in form order. */
export function departmentRequests(items: readonly Item[]): Array<{ department: string; items: string }> {
  return items
    .filter((i) => i.label === ITEMS && i.value?.trim())
    .map((i) => ({ department: i.section ?? LEGACY, items: i.value!.trim() }));
}

@Injectable()
export class StockRequestLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.stock_requests',
    name: 'Stock Requests',
    description: 'Every Kitchen Stock Request submitted in the period, newest first, by department.',
    domain: 'tasks',
    scope: 'branch',
    // A branch files one a day, so a period's log is short enough to send whole.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'department', label: 'Department', type: 'string' },
      { key: 'items', label: 'Items', type: 'string' },
      { key: 'item_count', label: 'Item Count', type: 'number' },
      { key: 'needed_by', label: 'Needed By', type: 'string' },
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
    ],
    options: [{ key: 'department', label: 'Department', values: [...STOCK_DEPARTMENTS, LEGACY] }],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, STOCK_REQUEST.name);
    const only = query.options.department;

    // Newest first, as the screen lists them.
    const rows = [...forms.submissions].reverse().flatMap((s) => {
      const items = forms.items.get(s.task_id) ?? [];
      const needed = items.find((i) => i.label === NEEDED_BY)?.value;
      return departmentRequests(items)
        .filter((d) => !only || d.department === only)
        .map((d) => ({
          task_id: s.task_id,
          date: dayLabel(toLocalDateString(s.report_date), true),
          submitted_by: s.submitted_by,
          department: d.department,
          items: d.items,
          item_count: itemCount(d.items),
          needed_by: needed ? dayLabel(needed, true) : null,
          submitted_at: instantLabel(s.completed_at, query.ctx.timezone),
        }));
    });

    const requests = new Set(rows.map((r) => r.task_id)).size;
    const totalItems = rows.reduce((sum, r) => sum + r.item_count, 0);
    return {
      rows,
      total: rows.length,
      metrics: [
        { key: 'total_requests', label: 'Total Requests', value: requests, type: 'number' },
        { key: 'total_items', label: 'Total Items', value: totalItems, type: 'number' },
        {
          key: 'avg_items',
          label: 'Avg Items',
          value: requests ? Math.round(totalItems / requests) : 0,
          type: 'number',
        },
        {
          key: 'departments',
          label: 'Departments',
          value: new Set(rows.map((r) => r.department)).size,
          type: 'number',
        },
      ],
    };
  }
}

/** Whether the Kitchen Stock Request was filed each day, per person responsible. */
@Injectable()
export class StockRequestComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.stock_requests_compliance',
    name: 'Stock Request Submission Compliance',
    description: 'Whether the Kitchen Stock Request was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, STOCK_REQUEST.name);
  }
}

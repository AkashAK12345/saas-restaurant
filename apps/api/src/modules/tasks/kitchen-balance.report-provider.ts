import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import { PERMISSION_KEYS } from '../../common/authorization/permission-keys.js';
import { toLocalDateString } from '../reports/report-values.js';
import {
  COMPLIANCE_COLUMNS,
  dayLabel,
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
 * Kitchen Balance reporting — each kitchen's closing stock count, read back.
 * See checklist-report.ts for what counts as a submission and whose day it is.
 *
 * A balance is a list of item counts grouped by kitchen section. The log
 * shows each submission's total across EVERY item, then the subtotal of the
 * sections a manager checks most; the rest (Indian, Fish) still count in the
 * total and stay on the task. Last-supplied dates are not counts and are
 * left out of every sum.
 */

/** Log column -> the form section it subtotals. */
const SECTION_COLUMNS = {
  biryani: { label: 'Biryani', section: 'Biryani' },
  mandi: { label: 'Mandi', section: 'Mandi' },
  tandoor: { label: 'Tandoor', section: 'Tandoor' },
  bbq: { label: 'BBQ', section: 'BBQ' },
  breads: { label: 'Breads', section: 'Breads' },
} as const;

const KITCHEN_BALANCE = referenceForm('kitchen-balance', []);
for (const { section } of Object.values(SECTION_COLUMNS)) {
  if (!KITCHEN_BALANCE.items.some((i) => i.section === section)) {
    throw new Error(`The Kitchen Balance form no longer has a "${section}" section`);
  }
}

/** A submission's total across every item, and per section. */
export function balanceTotals(answers: Iterable<ChecklistAnswer>): { total: number; bySection: Map<string, number> } {
  const all: number[] = [];
  const bySection = new Map<string, number[]>();
  for (const answer of answers) {
    const n = numberValue(answer);
    all.push(n);
    if (answer.section) bySection.set(answer.section, [...(bySection.get(answer.section) ?? []), n]);
  }
  return {
    total: exactSum(all),
    bySection: new Map([...bySection].map(([section, ns]) => [section, exactSum(ns)])),
  };
}

@Injectable()
export class KitchenBalanceLogReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.kitchen_balance',
    name: 'Kitchen Balance',
    description: 'Every Kitchen Balance Report submitted in the period, newest first, totalled by section.',
    domain: 'tasks',
    scope: 'branch',
    // A branch files one a day, so a period's log is short enough to send whole.
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: [
      { key: 'date', label: 'Date', type: 'string' },
      { key: 'submitted_by', label: 'Submitted By', type: 'string' },
      { key: 'branch_name', label: 'Branch', type: 'string' },
      { key: 'total', label: 'Total', type: 'number' },
      ...Object.entries(SECTION_COLUMNS).map(([key, c]) => ({ key, label: c.label, type: 'number' as const })),
      { key: 'submitted_at', label: 'Submitted At', type: 'string' },
    ],
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  async run(query: ReportQuery): Promise<ReportResult> {
    const forms = await loadSubmissions(this.prisma, query, KITCHEN_BALANCE.name);
    // Newest first, as the screen lists them.
    const rows = [...forms.submissions].reverse().map((s) => {
      const { total, bySection } = balanceTotals(forms.items.get(s.task_id) ?? []);
      return {
        task_id: s.task_id,
        date: dayLabel(toLocalDateString(s.report_date), true),
        submitted_by: s.submitted_by,
        total,
        ...Object.fromEntries(
          Object.entries(SECTION_COLUMNS).map(([key, c]) => [key, bySection.get(c.section) ?? 0]),
        ),
        submitted_at: instantLabel(s.completed_at, query.ctx.timezone),
      };
    });

    const totalItems = exactSum(rows.map((r) => r.total));
    return {
      rows,
      total: rows.length,
      metrics: [
        { key: 'total_reports', label: 'Total Reports', value: rows.length, type: 'number' },
        { key: 'total_items', label: 'Total Items', value: totalItems, type: 'number' },
        {
          key: 'avg_items',
          label: 'Avg Items',
          // Whole items per report, as the reference card reads.
          value: rows.length ? Math.round(totalItems / rows.length) : 0,
          type: 'number',
        },
      ],
    };
  }
}

/** Whether the Kitchen Balance Report was filed each day, per person responsible. */
@Injectable()
export class KitchenBalanceComplianceReport implements ReportProvider {
  readonly definition: ReportDefinition = {
    key: 'tasks.kitchen_balance_compliance',
    name: 'Kitchen Balance Submission Compliance',
    description: 'Whether the Kitchen Balance Report was filed each day, per person responsible.',
    domain: 'tasks',
    scope: 'branch',
    kind: 'summary',
    permission: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    columns: COMPLIANCE_COLUMNS,
    exportable: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  run(query: ReportQuery): Promise<ReportResult> {
    return runCompliance(this.prisma, query, KITCHEN_BALANCE.name);
  }
}

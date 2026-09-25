import type { AppIconName } from '@/components/app/icons';
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';

/**
 * The reports offered from the dashboard's Reports card — one per daily
 * checklist a branch submits, read back rather than filled in.
 *
 * `key` matches the backend's `REFERENCE_CHECKLISTS` key
 * (`apps/api/src/modules/tasks/reference-checklists.ts`) and the matching
 * Quick Access tile in `lib/tasks/quick-access.ts`, so the submission flow and
 * its report always name the same thing.
 *
 * The list, its order and its wording follow the reference app's Reports
 * sheet. Point of sale and purchasing have tables but nothing that fills them
 * yet, so their screens open and say honestly when there is nothing.
 * Request Reports has no data at all yet: its row is shown and does nothing.
 */
export interface ChecklistReport {
  key: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
  /** The report screen the row opens. Rows without one only close the sheet
   *  until their report is built. */
  reportKey?: string;
  /** A dedicated screen instead of a single report, e.g. POS Reports' tabs. */
  href?: string;
}

export const CHECKLIST_REPORTS: readonly ChecklistReport[] = [
  // The reference's own order and wording, row for row.
  { key: 'queue', title: 'Queue Reports', subtitle: 'Wait & seating data', icon: 'people', reportKey: 'queue.tokens' },
  {
    key: 'banquet',
    title: 'Banquet Reports',
    subtitle: 'Event analytics',
    icon: 'building',
    reportKey: 'banquet.bookings',
  },
  { key: 'tasks', title: 'Task Reports', subtitle: 'Completion rates', icon: 'checklist', reportKey: 'tasks.log' },
  // Not built yet: SAMCO records no service requests to report on.
  { key: 'requests', title: 'Request Reports', subtitle: 'Service requests', icon: 'document' },
  { key: 'eod', title: 'EOD Reports', subtitle: 'End of day reports', icon: 'clock', reportKey: 'tasks.eod' },
  {
    key: 'operational-checklist',
    title: 'Operational Checklist',
    subtitle: 'Checklist reports',
    icon: 'checklist',
    reportKey: 'tasks.operational',
  },
  {
    key: 'kitchen-checklist',
    title: 'Kitchen Checklist',
    subtitle: 'Kitchen reports',
    icon: 'fork',
    reportKey: 'tasks.kitchen',
  },
  {
    key: 'opening-checklist',
    title: 'Branch Head Opening',
    subtitle: 'Branch head opening reports',
    icon: 'lock',
    reportKey: 'tasks.opening',
  },
  {
    key: 'banquet-opening',
    title: 'Banquet Opening',
    subtitle: 'Banquet opening reports',
    icon: 'party',
    reportKey: 'tasks.banquet_opening',
  },
  {
    key: 'branch-manager-checklist',
    title: 'BM Checklist',
    subtitle: 'BM reports',
    icon: 'document',
    reportKey: 'tasks.bm',
  },
  {
    key: 'kitchen-balance',
    title: 'Kitchen Balance',
    subtitle: 'Balance reports',
    icon: 'scale',
    reportKey: 'tasks.kitchen_balance',
  },
  {
    key: 'biryani-sales',
    title: 'Biryani Sales',
    subtitle: 'Sales reports',
    icon: 'fork',
    reportKey: 'tasks.biryani_sales',
  },
  {
    key: 'kitchen-stock-request',
    title: 'Kitchen Stock Request',
    subtitle: 'Stock reports',
    icon: 'archive',
    reportKey: 'tasks.stock_requests',
  },
  { key: 'pos', title: 'POS Reports', subtitle: 'Sales analytics', icon: 'receipt', href: '/reports/pos' },
  { key: 'purchase', title: 'Purchase Orders', subtitle: 'Purchase reports', icon: 'truck', href: '/reports/purchase' },
];

/**
 * Where a row opens: its own screen, else its report. Null for a row whose
 * report is not built yet. The dashboard sheet and the Reports page both ask
 * here, so they can never send the same row to two places.
 */
export function reportHref(report: ChecklistReport): string | null {
  if (report.href) return report.href;
  return report.reportKey ? `/reports/${report.reportKey}` : null;
}

/**
 * Whether a catalogue report is already reached through a row above: a row's
 * own report, a report shown on a row's screen (POS, purchasing), or the
 * compliance panel that sits under its log. The Reports page lists only the
 * rest under "More reports", so nothing appears twice.
 */
export function coveredByChecklistReports(key: string): boolean {
  if (CHECKLIST_REPORTS.some((r) => r.reportKey === key)) return true;
  if (key.startsWith('pos.') || key.startsWith('purchase.')) return true;
  return key.endsWith('_compliance');
}

/** Reading a checklist report is reading a report. */
export const CHECKLIST_REPORTS_PERMISSION: PermissionKey = PERMISSION_KEYS.REPORTS_VIEW;

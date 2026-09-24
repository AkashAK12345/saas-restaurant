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
 * Point of sale and purchasing lead: their tables exist (taking orders and
 * raising purchase orders are still to come), so their screens open and say
 * honestly when there is nothing yet. The checklist reports follow.
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
  { key: 'pos', title: 'POS Reports', subtitle: 'Sales & orders', icon: 'receipt', href: '/reports/pos' },
  {
    key: 'purchase',
    title: 'Purchase Reports',
    subtitle: 'Vendors & purchase orders',
    icon: 'truck',
    href: '/reports/purchase',
  },
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
    icon: 'notes',
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
];

/** Reading a checklist report is reading a report. */
export const CHECKLIST_REPORTS_PERMISSION: PermissionKey = PERMISSION_KEYS.REPORTS_VIEW;

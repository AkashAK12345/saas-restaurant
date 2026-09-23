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
 * Only the checklists that actually capture data are listed. A report for a
 * module SAMCO does not have yet (point of sale, purchasing) would have
 * nothing behind it, so it is left out rather than shown empty.
 */
export interface ChecklistReport {
  key: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
}

export const CHECKLIST_REPORTS: readonly ChecklistReport[] = [
  { key: 'operational-checklist', title: 'Operational Checklist', subtitle: 'Checklist reports', icon: 'checklist' },
  { key: 'kitchen-checklist', title: 'Kitchen Checklist', subtitle: 'Kitchen reports', icon: 'fork' },
  { key: 'opening-checklist', title: 'Branch Head Opening', subtitle: 'Branch head opening reports', icon: 'lock' },
  { key: 'banquet-opening', title: 'Banquet Opening', subtitle: 'Banquet opening reports', icon: 'party' },
  { key: 'branch-manager-checklist', title: 'BM Checklist', subtitle: 'BM reports', icon: 'notes' },
  { key: 'kitchen-balance', title: 'Kitchen Balance', subtitle: 'Balance reports', icon: 'scale' },
  { key: 'biryani-sales', title: 'Biryani Sales', subtitle: 'Sales reports', icon: 'fork' },
  { key: 'kitchen-stock-request', title: 'Kitchen Stock Request', subtitle: 'Stock reports', icon: 'archive' },
];

/** Reading a checklist report is reading a report. */
export const CHECKLIST_REPORTS_PERMISSION: PermissionKey = PERMISSION_KEYS.REPORTS_VIEW;

import type { AppIconName } from '@/components/app/icons';

/**
 * The Task Dashboard's Quick Access shortcuts — one per daily report or
 * checklist a branch submits routinely.
 *
 * `key` matches the backend's `REFERENCE_CHECKLISTS` key
 * (`apps/api/src/modules/tasks/reference-checklists.ts`) wherever one exists,
 * so wiring a tile to its real submission flow later is a lookup, not a
 * rename. branch-manager-checklist has no reference definition on the
 * backend yet (the source names its purpose but not its items); an operator
 * builds it with the ordinary checklist editor. activity-calendar is not a
 * checklist at all.
 *
 * Each entry only describes the tile — what a tap actually does is still
 * being built out one submodule at a time.
 */
export interface QuickAccessItem {
  key: string;
  title: string;
  description: string;
  icon: AppIconName;
}

export const QUICK_ACCESS_ITEMS: readonly QuickAccessItem[] = [
  { key: 'eod-report', title: 'EOD Report', description: 'Submit daily End-of-Day report', icon: 'clipboard' },
  { key: 'operational-checklist', title: 'Operational Checklist', description: 'Submit daily operational checklist', icon: 'checklist' },
  { key: 'kitchen-checklist', title: 'Kitchen Checklist', description: 'Submit daily kitchen checklist', icon: 'fridge' },
  { key: 'opening-checklist', title: 'Branch Head Opening Checklist', description: 'Submit daily opening checklist', icon: 'sun' },
  { key: 'banquet-opening', title: 'Banquet Opening', description: 'Submit daily banquet opening checklist', icon: 'calendarCheck' },
  { key: 'branch-manager-checklist', title: 'Branch Manager Checklist', description: 'Submit daily branch manager checklist', icon: 'clipboardCheck' },
  { key: 'kitchen-balance', title: 'Kitchen Balance Report', description: 'Submit daily kitchen balance report', icon: 'box' },
  { key: 'biryani-sales', title: 'Biryani Sales', description: 'Submit daily biryani sales report', icon: 'fork' },
  { key: 'kitchen-stock-request', title: 'Kitchen Stock Request', description: 'Submit daily kitchen stock request', icon: 'cart' },
  { key: 'kitchen-wastage', title: 'Kitchen Wastage', description: 'Submit daily kitchen wastage report', icon: 'trash' },
  { key: 'corporate-branch-visit', title: 'Corporate Branch Visit Report', description: 'Submit corporate branch visit report', icon: 'briefcase' },
  { key: 'activity-calendar', title: 'Activity Calendar', description: 'View monthly activity calendar', icon: 'calendar' },
];

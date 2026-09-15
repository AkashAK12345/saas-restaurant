import type { PermissionKey } from '../../common/authorization/permission-keys.js';
import type { ReportContext, ReportRange, ReportValueType } from './report-contract.js';

/**
 * The dashboard contract.
 *
 * A WIDGET is a small, self-contained answer to one operational question —
 * "how is the queue right now", "what is still outstanding on banquet". Like
 * reports, widgets are registered by their own domain module and the
 * dashboard engine knows nothing about any of them.
 *
 * Widgets are deliberately not reports: a report is something you read and
 * export, a widget is something you glance at. Keeping them separate stops
 * the dashboard from paginating and the reports from pretending to be tiles.
 */
export type WidgetDisplay = 'metrics' | 'breakdown' | 'series';

/**
 * A per-day series for a chart tile. `points` holds EVERY branch-local date in
 * the window, oldest first, with zeroes where nothing happened — a missing day
 * would otherwise draw as no bar and read as missing data. Values are counts,
 * so a series may be added across branches date by date.
 */
export interface WidgetSeries {
  keys: Array<{ key: string; label: string }>;
  points: Array<{ date: string; values: Record<string, number> }>;
}

export interface WidgetMetric {
  key: string;
  label: string;
  value: number | string | null;
  type: ReportValueType;
  currency?: string;
  /** Draws attention on the tile — overdue work, unpaid balances. */
  emphasis?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export interface DashboardWidgetDefinition {
  /** Stable, machine-readable, e.g. "queue.today". Never renamed. */
  key: string;
  title: string;
  domain: string;
  display: WidgetDisplay;
  /** The DOMAIN permission required at the branch, beyond dashboard.view. */
  permission: PermissionKey;
  /**
   * True when the widget describes the here-and-now rather than the selected
   * window, so the UI can say so instead of implying the date filter applies.
   */
  live: boolean;
}

export interface WidgetQuery {
  ctx: ReportContext;
  range: ReportRange;
}

export interface WidgetResult {
  metrics: WidgetMetric[];
  series?: WidgetSeries;
}

export interface DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition;
  run(query: WidgetQuery): Promise<WidgetResult>;
}

export interface DashboardWidgetResponse extends DashboardWidgetDefinition {
  metrics: WidgetMetric[];
  series?: WidgetSeries;
  /** Set when this widget failed; the rest of the dashboard still renders. */
  error?: string;
}

export interface DashboardResponse {
  branch_id: string;
  timezone: string;
  generated_at: string;
  filters: { from: string; to: string };
  widgets: DashboardWidgetResponse[];
}

// ── All branches ─────────────────────────────────────────────────────────────

/**
 * One widget summed across every branch the caller may see.
 *
 * AGGREGATE ONLY, and only where adding up is honest: counts and money (per
 * currency) are summed. A percentage, a duration or an average cannot be
 * added across branches, so it is never faked — it appears per branch only,
 * and is listed in `not_summed` so the tile can say so.
 */
export interface AllBranchesWidgetResponse extends DashboardWidgetDefinition {
  metrics: WidgetMetric[];
  /** Date-by-date sum of the branches' series, when the widget has one. */
  series?: WidgetSeries;
  not_summed: string[];
  branches: Array<{
    branch_id: string;
    branch_name: string;
    metrics: WidgetMetric[];
    series?: WidgetSeries;
    error?: string;
  }>;
}

export interface AllBranchesDashboardResponse {
  scope: 'all_branches';
  company_id: string;
  generated_at: string;
  /** Branch-local dates, applied in each branch's own timezone. */
  filters: { from: string | null; to: string | null };
  branches: Array<{ id: string; name: string; timezone: string }>;
  widgets: AllBranchesWidgetResponse[];
}

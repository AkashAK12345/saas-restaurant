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
export type WidgetDisplay = 'metrics' | 'breakdown';

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
}

export interface DashboardWidgetProvider {
  readonly definition: DashboardWidgetDefinition;
  run(query: WidgetQuery): Promise<WidgetResult>;
}

export interface DashboardWidgetResponse extends DashboardWidgetDefinition {
  metrics: WidgetMetric[];
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

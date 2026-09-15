/**
 * The reporting envelope, exactly as the API returns it.
 *
 * These types mirror `apps/api/src/modules/reports/report-contract.ts`. They
 * are DELIBERATELY generic: the frontend renders whatever columns and metrics
 * a report declares, so a report added to a future backend module appears here
 * with no frontend change at all.
 */
export type ReportKind = 'summary' | 'rows';

export type ReportValueType =
  | 'string'
  | 'number'
  | 'percent'
  | 'money'
  | 'duration'
  | 'date'
  | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportValueType;
}

export interface ReportOptionSpec {
  key: string;
  label: string;
  values: readonly string[];
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  domain: string;
  scope: 'branch';
  kind: ReportKind;
  columns: readonly ReportColumn[];
  options?: readonly ReportOptionSpec[];
  exportable: boolean;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number | string | null;
  type: ReportValueType;
  /** ISO 4217; present on money metrics. */
  currency?: string;
}

/** Rows carry `id_key`; the row links to `path` with ":id" replaced. */
export interface ReportDrilldown {
  id_key: string;
  path: string;
}

export interface ReportResponse {
  key: string;
  name: string;
  description: string;
  domain: string;
  kind: ReportKind;
  generated_at: string;
  /** The branch's IANA zone — the authority for every date shown. */
  timezone: string;
  branch_name?: string;
  /** Present when rows open a record of their own. */
  drilldown?: ReportDrilldown | null;
  filters: {
    branch_id: string;
    from: string;
    to: string;
    options: Record<string, string>;
  };
  columns: readonly ReportColumn[];
  /** The filters this report offers; `filters.options` is what was applied. */
  option_specs: readonly ReportOptionSpec[];
  /** Whether the report may be downloaded at all, before permissions. */
  exportable: boolean;
  metrics: ReportMetric[];
  rows: Array<Record<string, unknown>>;
  meta: { total: number; limit: number; offset: number };
}

export interface ReportCatalogue {
  data: ReportDefinition[];
  meta: { total: number };
}

export type ExportFormat = 'xlsx' | 'pdf';

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface WidgetMetric extends ReportMetric {
  emphasis?: 'neutral' | 'positive' | 'warning' | 'danger';
}

/** Per-day counts for a chart tile: every date in the window, zeroes included. */
export interface WidgetSeries {
  keys: Array<{ key: string; label: string }>;
  points: Array<{ date: string; values: Record<string, number> }>;
}

export interface DashboardWidget {
  key: string;
  title: string;
  domain: string;
  display: 'metrics' | 'breakdown' | 'series';
  /** True when the widget describes now, not the selected window. */
  live: boolean;
  metrics: WidgetMetric[];
  series?: WidgetSeries;
  /** Present when this one widget failed; the rest of the page still renders. */
  error?: string;
}

export interface DashboardResponse {
  branch_id: string;
  timezone: string;
  generated_at: string;
  filters: { from: string; to: string };
  widgets: DashboardWidget[];
}

/**
 * One widget summed across branches. Only counts and money are summed; any
 * metric that cannot honestly be added is named in `not_summed` and shown per
 * branch instead.
 */
export interface AllBranchesWidget extends DashboardWidget {
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
  filters: { from: string | null; to: string | null };
  branches: Array<{ id: string; name: string; timezone: string }>;
  widgets: AllBranchesWidget[];
}

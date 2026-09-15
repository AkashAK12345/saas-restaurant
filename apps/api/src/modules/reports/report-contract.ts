import type { PermissionKey } from '../../common/authorization/permission-keys.js';

/**
 * The reporting contract.
 *
 * A REPORT is described by a provider that lives in its own domain module —
 * queue reports in the queue module, banquet reports in the banquet module —
 * and registers itself with the registry at startup. The reporting engine
 * knows nothing about any domain, so a future module (POS, inventory) adds
 * reports by registering a provider, without this file changing at all.
 *
 * That is the whole extensibility story, and it is deliberately small: no
 * plugin loader, no dynamic imports, no configuration format.
 */

/** Every current report is branch-scoped; the type leaves room for more. */
export type ReportScope = 'branch';

/**
 * `summary` reports answer "how did we do" with metrics plus a small grouped
 * breakdown. `rows` reports are tabular and paginated. The distinction drives
 * pagination, export layout and how the frontend renders them.
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

/** A filter the report accepts beyond the universal branch + date range. */
export interface ReportOptionSpec {
  key: string;
  label: string;
  /** Allowed values. Anything else is rejected — options are never free text. */
  values: readonly string[];
}

export interface ReportDefinition {
  /** Stable, machine-readable, e.g. "queue.summary". Never renamed. */
  key: string;
  name: string;
  description: string;
  /** The module this belongs to; used for grouping in the UI. */
  domain: string;
  scope: ReportScope;
  kind: ReportKind;
  /**
   * The DOMAIN permission a caller must hold at the branch, on top of
   * reports.view. Holding reports.view alone must never reveal a domain the
   * caller cannot otherwise see — see ReportsService.
   */
  permission: PermissionKey;
  columns: readonly ReportColumn[];
  options?: readonly ReportOptionSpec[];
  /** Money columns carry minor units; the currency is per-row where it varies. */
  exportable: boolean;
  /**
   * Drill-down to the source record: rows carry `id_key`, and the client links
   * the row to `path` with ":id" replaced. Only for records that have a screen
   * of their own; an aggregate row has nothing to open.
   */
  drilldown?: ReportDrilldown;
}

export interface ReportDrilldown {
  id_key: string;
  /** App path with an ":id" placeholder, e.g. "/banquet/:id". */
  path: string;
}

/** Guard-verified context. The ids here are proven, not requested. */
export interface ReportContext {
  companyId: string;
  branchId: string;
  actorUserId: string;
  /** The branch's IANA timezone — the authority for every date in a report. */
  timezone: string;
}

/**
 * A resolved date window.
 *
 * `from`/`to` are absolute instants; `fromLocal`/`toLocal` are the
 * branch-local calendar dates the user actually asked for. Providers should
 * filter on the instants and label with the local dates.
 *
 * The window is HALF-OPEN: from <= t < to, so a single day is exactly that
 * day however many hours it happened to have.
 */
export interface ReportRange {
  from: Date;
  to: Date;
  fromLocal: string;
  toLocal: string;
  days: number;
}

export interface ReportPage {
  limit: number;
  offset: number;
}

export interface ReportQuery {
  ctx: ReportContext;
  range: ReportRange;
  /** Validated against the definition's option specs. */
  options: Readonly<Record<string, string>>;
  page: ReportPage;
}

/** A headline figure shown above the table. */
export interface ReportMetric {
  key: string;
  label: string;
  value: number | string | null;
  type: ReportValueType;
  /** ISO 4217, for money metrics only. */
  currency?: string;
}

export interface ReportResult {
  rows: Array<Record<string, unknown>>;
  /** Total rows matching the filters, for pagination. */
  total: number;
  metrics?: ReportMetric[];
}

export interface ReportProvider {
  readonly definition: ReportDefinition;
  run(query: ReportQuery): Promise<ReportResult>;
}

/** The envelope every report response uses, whatever the domain. */
export interface ReportResponse {
  key: string;
  name: string;
  description: string;
  domain: string;
  kind: ReportKind;
  generated_at: string;
  timezone: string;
  /** For provenance in exports: a person reads a branch name, not a uuid. */
  branch_name: string;
  filters: {
    branch_id: string;
    from: string;
    to: string;
    options: Record<string, string>;
  };
  columns: readonly ReportColumn[];
  drilldown: ReportDrilldown | null;
  /**
   * The filters this report OFFERS, so a client can render the controls from
   * the same response that carries the data. `filters.options` above is what
   * was actually applied; these are the choices.
   */
  option_specs: readonly ReportOptionSpec[];
  /** Whether this report may be downloaded at all, before permissions. */
  exportable: boolean;
  metrics: ReportMetric[];
  rows: Array<Record<string, unknown>>;
  meta: { total: number; limit: number; offset: number };
}

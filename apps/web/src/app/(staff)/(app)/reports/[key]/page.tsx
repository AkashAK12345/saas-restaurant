'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { reportsApi, saveFile, type ReportQuery } from '@/lib/reports/api';
import { MetricGrid } from '@/components/reports/metric-grid';
import { ReportTable } from '@/components/reports/report-table';
import { formatDateLabel } from '@/lib/reports/format';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import {
  EOD_COMPLIANCE_CARDS,
  EOD_LOG_METRIC_ICONS,
  complianceCountLabel,
  complianceMetricIcons,
  complianceTone,
} from '@/lib/reports/eod-ui';
import { OPERATIONAL_LOG_METRIC_ICONS } from '@/lib/reports/operational-ui';
import { KITCHEN_LOG_METRIC_ICONS } from '@/lib/reports/kitchen-ui';
import { STOCK_REQUEST_METRIC_ICONS, STOCK_REQUEST_SEARCHABLE_COLUMNS } from '@/lib/reports/stock-request-ui';
import {
  BIRYANI_SALES_CARDS,
  BIRYANI_SALES_METRIC_ICONS,
  BIRYANI_SALES_SEARCHABLE_COLUMNS,
} from '@/lib/reports/biryani-sales-ui';
import {
  KITCHEN_BALANCE_METRIC_ICONS,
  KITCHEN_BALANCE_SEARCHABLE_COLUMNS,
} from '@/lib/reports/kitchen-balance-ui';
import {
  BANQUET_OPENING_SECTION_LOOKS,
  OPENING_LOG_METRIC_ICONS,
  OPENING_SEARCHABLE_COLUMNS,
  OPENING_SECTION_LOOKS,
} from '@/lib/reports/opening-ui';
import { ChecklistDetailsDialog, type SectionLook } from '@/components/reports/checklist-details-dialog';
import {
  BM_LOG_CARDS,
  BM_LOG_METRIC_ICONS,
  BM_SEARCHABLE_COLUMNS,
  BM_YES_NO_COLUMNS,
  scoreTone,
  yesNoTone,
} from '@/lib/reports/bm-ui';
import { QUEUE_METRIC_ICONS, QUEUE_STATUS_BADGES, QUEUE_SEARCHABLE_COLUMNS } from '@/lib/reports/queue-tokens-ui';
import {
  BANQUET_METRIC_ICONS,
  BANQUET_STATUS_BADGES,
  BANQUET_SEARCHABLE_COLUMNS,
  banquetRevenueIcon,
} from '@/lib/reports/banquet-bookings-ui';
import {
  TASK_METRIC_ICONS,
  TASK_PRIORITY_BADGES,
  TASK_SEARCHABLE_COLUMNS,
  TASK_STATUS_BADGES,
  TASK_VIEW_CHIPS,
} from '@/lib/reports/tasks-log-ui';
import type { MetricIcon } from '@/components/reports/metric-grid';
import type { BadgeSpec } from '@/components/reports/report-table';
import type { ExportFormat, ReportMetric, ReportResponse } from '@/lib/reports/types';
import styles from '@/components/reports/reports.module.css';

const PAGE_SIZE = 50;

/**
 * Reports whose page wraps the table in a titled, searchable panel with
 * icon-badged headline metrics and coloured status pills, rather than the
 * plain metrics-then-table layout every other report gets. Adding a key
 * here is the ONLY frontend change a report needs for this treatment — the
 * table and metric grid components themselves stay fully generic.
 */
interface ReportUiHint {
  title: string;
  /** The glyph beside the panel title; a table by default. */
  panelIcon?: AppIconName;
  /** The badge beside the title; "N entries" by default. */
  countLabel?: (report: ReportResponse) => string;
  /** Omitted: no search box. */
  searchPlaceholder?: string;
  searchableColumns?: readonly string[];
  badges?: Readonly<Record<string, Readonly<Record<string, BadgeSpec>>>>;
  /** Numeric columns shown as a coloured pill, e.g. a compliance rate. */
  valuePills?: Readonly<Record<string, (value: number) => BadgeSpec['tone'] | undefined>>;
  table?: {
    stickyFirstColumn?: boolean;
    wrapCells?: boolean;
    boldFirstColumn?: boolean;
    /** Long text cut to one line with "…". */
    clampColumns?: readonly string[];
    /** Set in bold, e.g. a row's total. */
    boldColumns?: readonly string[];
  };
  /** A filter dropdown's "everything" choice, e.g. "All departments"; "All"
   *  when unset. */
  optionAllLabels?: Readonly<Record<string, string>>;
  /** Any column's value shown as a coloured pill, e.g. Yes/No or "5/6". */
  textPills?: Readonly<Record<string, (value: unknown) => BadgeSpec['tone'] | undefined>>;
  /** A pill after a cell, read from its row — e.g. "+1 filed" by Pending. */
  cellAddons?: Readonly<Record<string, (row: Record<string, unknown>) => BadgeSpec | undefined>>;
  /** Each row opens its submitted checklist in full (a "View" column). The
   *  row must carry the task's id as `task_id`. */
  details?: {
    title: string;
    icon: AppIconName;
    subtitle: (row: Record<string, unknown>) => string;
    tone?: 'amber' | 'red';
    sectionLooks?: Readonly<Record<string, SectionLook>>;
  };
  /** Any column's text coloured by its raw value, e.g. a missed count in red. */
  textTones?: Readonly<Record<string, (value: unknown) => 'success' | 'danger' | undefined>>;
  /** The empty panel's line, when "No data found" would not say why. */
  emptyText?: string;
  /** Another report rendered beneath this one over the SAME dates — one
   *  screen answering two questions, as the EOD screen does (what was
   *  filed, and whether it was filed). It keeps its own hint. */
  companion?: string;
  /** Icons per metric key; may also derive one from a dynamic key (e.g. a
   *  per-currency "revenue_INR"). */
  metricIcons: (metrics: readonly ReportMetric[]) => Record<string, MetricIcon>;
  /** When set, only these metric keys render as headline cards — the API
   *  response (and export) still carries the rest. */
  visibleMetricKeys?: (metrics: readonly ReportMetric[]) => readonly string[];
  /** Money columns whose sign gets coloured text (e.g. an overpaid balance
   *  in green, still-owed in red/amber) rather than the plain black number
   *  every other money column gets. */
  amountTones?: Readonly<Record<string, (value: number) => 'success' | 'danger' | undefined>>;
  /** Render one declared option as a row of chips (plus "All") instead of a
   *  dropdown. The value still goes to the SERVER like any other filter. */
  chips?: {
    optionKey: string;
    values: ReadonlyArray<{ value: string; label: string }>;
  };
}

/**
 * "Did they file it?" beneath a daily checklist's log — the same panel on
 * every checklist screen; only its empty line names the form.
 */
function complianceHint(emptyText: string): ReportUiHint {
  return {
    title: 'Submission Compliance',
    panelIcon: 'clipboardCheck',
    countLabel: (report) => complianceCountLabel(report.metrics),
    metricIcons: complianceMetricIcons,
    visibleMetricKeys: () => EOD_COMPLIANCE_CARDS,
    valuePills: { compliance: complianceTone },
    table: { boldFirstColumn: true },
    textTones: {
      missed: (value) => (typeof value === 'number' && value > 0 ? 'danger' : undefined),
      missed_dates: (value) => (value ? 'danger' : undefined),
    },
    cellAddons: {
      pending: (row) => {
        const filed = Number(row.filed_today ?? 0);
        return filed > 0 ? { label: `+${filed} filed`, tone: 'success' } : undefined;
      },
    },
    emptyText,
  };
}

const REPORT_UI_HINTS: Readonly<Record<string, ReportUiHint>> = {
  'queue.tokens': {
    title: 'Queue Log',
    searchPlaceholder: 'Search customer…',
    searchableColumns: QUEUE_SEARCHABLE_COLUMNS,
    badges: { status: QUEUE_STATUS_BADGES },
    metricIcons: () => QUEUE_METRIC_ICONS,
  },
  'banquet.bookings': {
    title: 'Bookings',
    searchPlaceholder: 'Search…',
    searchableColumns: BANQUET_SEARCHABLE_COLUMNS,
    badges: { status: BANQUET_STATUS_BADGES },
    metricIcons: (metrics) => {
      const icons: Record<string, MetricIcon> = { ...BANQUET_METRIC_ICONS };
      for (const m of metrics) {
        const icon = banquetRevenueIcon(m.key);
        if (icon) icons[m.key] = icon;
      }
      return icons;
    },
    // Four cards, matching the reference design — the full per-currency
    // breakdown (booked/collected/balance) stays in the response for export.
    visibleMetricKeys: (metrics) => {
      const revenueKey = metrics.find((m) => m.key.startsWith('revenue_'))?.key;
      return ['total_bookings', 'confirmed', 'drafts', ...(revenueKey ? [revenueKey] : [])];
    },
    amountTones: {
      // Owing (positive) reads as a warning; overpaid (negative) as fine.
      balance_minor: (value) => (value > 0 ? 'danger' : value < 0 ? 'success' : undefined),
    },
  },
  'tasks.log': {
    title: 'Task Log',
    searchPlaceholder: 'Search task…',
    searchableColumns: TASK_SEARCHABLE_COLUMNS,
    badges: { status: TASK_STATUS_BADGES, priority: TASK_PRIORITY_BADGES },
    metricIcons: () => TASK_METRIC_ICONS,
    chips: { optionKey: 'view', values: TASK_VIEW_CHIPS },
  },
  'tasks.eod': {
    title: 'EOD Log (Transposed)',
    metricIcons: () => EOD_LOG_METRIC_ICONS,
    table: { stickyFirstColumn: true, wrapCells: true },
    companion: 'tasks.eod_compliance',
  },
  'tasks.eod_compliance': complianceHint('No EOD Report was scheduled for anyone in this period'),
  'tasks.operational': {
    title: 'Checklist Log (Transposed)',
    metricIcons: () => OPERATIONAL_LOG_METRIC_ICONS,
    table: { stickyFirstColumn: true, wrapCells: true },
    companion: 'tasks.operational_compliance',
  },
  'tasks.operational_compliance': complianceHint(
    'No Operational Checklist was scheduled for anyone in this period',
  ),
  'tasks.kitchen': {
    title: 'Kitchen Log',
    metricIcons: () => KITCHEN_LOG_METRIC_ICONS,
    companion: 'tasks.kitchen_compliance',
  },
  'tasks.kitchen_compliance': complianceHint('No Kitchen Checklist was scheduled for anyone in this period'),
  'tasks.opening': {
    title: 'Checklist Log',
    searchPlaceholder: 'Search...',
    searchableColumns: OPENING_SEARCHABLE_COLUMNS,
    metricIcons: () => OPENING_LOG_METRIC_ICONS,
    table: { clampColumns: ['remarks'] },
    companion: 'tasks.opening_compliance',
    details: {
      title: 'Branch Head Opening Details',
      icon: 'sun',
      subtitle: (row) => [row.date, row.submitted_by].filter(Boolean).join(' - '),
      sectionLooks: OPENING_SECTION_LOOKS,
    },
  },
  'tasks.opening_compliance': complianceHint(
    'No Branch Head Opening Checklist was scheduled for anyone in this period',
  ),
  'tasks.banquet_opening': {
    title: 'Checklist Log',
    searchPlaceholder: 'Search...',
    searchableColumns: [...OPENING_SEARCHABLE_COLUMNS, 'party_bookings'],
    metricIcons: () => OPENING_LOG_METRIC_ICONS,
    table: { clampColumns: ['party_bookings', 'remarks'] },
    companion: 'tasks.banquet_opening_compliance',
    details: {
      title: 'Banquet Opening Checklist Details',
      icon: 'party',
      tone: 'red',
      subtitle: (row) => [row.date, row.submitted_by].filter(Boolean).join(' - '),
      sectionLooks: BANQUET_OPENING_SECTION_LOOKS,
    },
  },
  'tasks.banquet_opening_compliance': complianceHint(
    'No Banquet Opening Checklist was scheduled for anyone in this period',
  ),
  'tasks.bm': {
    title: 'BM Checklist Log',
    searchPlaceholder: 'Search...',
    searchableColumns: BM_SEARCHABLE_COLUMNS,
    metricIcons: () => BM_LOG_METRIC_ICONS,
    visibleMetricKeys: () => BM_LOG_CARDS,
    textPills: {
      daily_score: scoreTone,
      briefing_score: scoreTone,
      ...Object.fromEntries(BM_YES_NO_COLUMNS.map((key) => [key, yesNoTone])),
    },
    table: { clampColumns: ['remarks'] },
    companion: 'tasks.bm_compliance',
    details: {
      title: 'BM Checklist Details',
      icon: 'notes',
      tone: 'red',
      subtitle: (row) => [row.date, row.manager ?? row.submitted_by].filter(Boolean).join(' - '),
    },
  },
  'tasks.bm_compliance': complianceHint('No BM Checklist was scheduled for anyone in this period'),
  'tasks.kitchen_balance': {
    title: 'Balance Log',
    searchPlaceholder: 'Search...',
    searchableColumns: KITCHEN_BALANCE_SEARCHABLE_COLUMNS,
    metricIcons: () => KITCHEN_BALANCE_METRIC_ICONS,
    table: { boldColumns: ['total'] },
    companion: 'tasks.kitchen_balance_compliance',
  },
  'tasks.kitchen_balance_compliance': complianceHint(
    'No Kitchen Balance Report was scheduled for anyone in this period',
  ),
  'tasks.biryani_sales': {
    title: 'Sales Log',
    searchPlaceholder: 'Search...',
    searchableColumns: BIRYANI_SALES_SEARCHABLE_COLUMNS,
    metricIcons: () => BIRYANI_SALES_METRIC_ICONS,
    visibleMetricKeys: () => BIRYANI_SALES_CARDS,
    table: { clampColumns: ['remarks'] },
    companion: 'tasks.biryani_sales_compliance',
    // The per-product split is on the form itself.
    details: {
      title: 'Biryani Sales Details',
      icon: 'bowl',
      tone: 'red',
      subtitle: (row) => [row.date, row.submitted_by].filter(Boolean).join(' - '),
    },
  },
  'tasks.biryani_sales_compliance': complianceHint(
    'No Biryani Sales Report was scheduled for anyone in this period',
  ),
  'tasks.stock_requests': {
    title: 'Stock Request Log',
    searchPlaceholder: 'Search...',
    searchableColumns: STOCK_REQUEST_SEARCHABLE_COLUMNS,
    metricIcons: () => STOCK_REQUEST_METRIC_ICONS,
    optionAllLabels: { department: 'All departments' },
    table: { clampColumns: ['items'] },
    companion: 'tasks.stock_requests_compliance',
    details: {
      title: 'Stock Request Details',
      icon: 'cart',
      tone: 'red',
      subtitle: (row) => [row.date, row.submitted_by].filter(Boolean).join(' - '),
    },
  },
  'tasks.stock_requests_compliance': complianceHint(
    'No Kitchen Stock Request was scheduled for anyone in this period',
  ),
};

/**
 * One hinted report's cards and titled panel. The primary report passes its
 * search box state; a companion shows no search.
 */
function ReportPanel({
  report,
  hint,
  rows,
  search,
  onSearch,
  onView,
}: {
  report: ReportResponse;
  hint: ReportUiHint;
  rows: ReadonlyArray<Record<string, unknown>>;
  search?: string;
  onSearch?: (value: string) => void;
  /** Opens a row's submission in full; set for a hint with `details`. */
  onView?: (row: Record<string, unknown>) => void;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon} aria-hidden="true">
          <AppIcon name={hint.panelIcon ?? 'columns'} size={22} />
        </span>
        <h2 className={styles.panelTitle}>{hint.title}</h2>
        <span className={styles.panelCount}>
          {hint.countLabel
            ? hint.countLabel(report)
            : `${report.meta.total} ${report.meta.total === 1 ? 'entry' : 'entries'}`}
        </span>
      </div>
      {hint.searchPlaceholder && onSearch ? (
        <label className={styles.searchBox}>
          <span className="sr-only">{hint.searchPlaceholder}</span>
          <AppIcon name="search" size={18} />
          <input
            className={styles.searchInput}
            type="search"
            placeholder={hint.searchPlaceholder}
            value={search ?? ''}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      ) : null}
      <ReportTable
        columns={report.columns}
        rows={rows}
        timezone={report.timezone}
        caption={`${report.name}, ${formatDateLabel(report.filters.from)} to ${formatDateLabel(report.filters.to)}`}
        drilldown={report.drilldown}
        badges={hint.badges}
        amountTones={hint.amountTones}
        valuePills={hint.valuePills}
        emptyVariant="panel"
        emptyText={hint.emptyText}
        stickyFirstColumn={hint.table?.stickyFirstColumn}
        wrapCells={hint.table?.wrapCells}
        boldFirstColumn={hint.table?.boldFirstColumn}
        textTones={hint.textTones}
        cellAddons={hint.cellAddons}
        clampColumns={hint.table?.clampColumns}
        textPills={hint.textPills}
        boldColumns={hint.table?.boldColumns}
        rowAction={
          hint.details && onView
            ? {
                header: 'Details',
                label: 'View',
                describe: (row) => String(row.date ?? ''),
                onSelect: onView,
              }
            : undefined
        }
      />
    </div>
  );
}

/** The cards a hint chooses to show, with their icons. */
function hintedMetrics(report: ReportResponse, hint: ReportUiHint) {
  const keys = hint.visibleMetricKeys?.(report.metrics);
  return {
    metrics: keys ? report.metrics.filter((m) => keys.includes(m.key)) : report.metrics,
    icons: hint.metricIcons(report.metrics),
  };
}

/**
 * One report.
 *
 * GENERIC BY CONSTRUCTION: this page knows no report by name. Columns,
 * filters, metrics and pagination all come from the definition the server
 * returned, so a report registered by a future backend module renders here
 * without a line of frontend work.
 *
 * Every filter change is a SERVER query. The browser never holds more than the
 * page on screen, and an export goes through the same endpoint family, so it
 * can never contain a row the viewer could not already read.
 */
export default function ReportPage() {
  const params = useParams<{ key: string }>();
  const reportKey = Array.isArray(params.key) ? params.key[0] : params.key;

  const { selectedCompanyId, selectedBranchId, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayExport = hasPermission(branchPermissions, 'reports.export');

  // Dates are BRANCH-LOCAL calendar days, and the branch's timezone is not
  // known until the server answers. So the first run sends no dates at all and
  // lets the API pick its default window in the branch's own zone, and the
  // pickers DISPLAY what it used. Guessing here with the viewer's clock would
  // show "today" a day out for half the world.
  //
  // These hold only what the USER chose; empty means "server default". They are
  // deliberately never written back from the response: doing that changed the
  // query and fired a second, identical request, which left the page loading —
  // and its buttons disabled — after the table had already appeared.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  // Bumped by "Run" so pressing it always asks the server again — even when
  // nothing in the form changed and the page is already on the first page.
  // Without it the button did nothing at all in that state.
  const [runs, setRuns] = useState(0);
  // Filters the page already on screen — the server still holds every row
  // beyond it, same as the "never more than the page on screen" rule above.
  const [search, setSearch] = useState('');

  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const query = useMemo<ReportQuery>(
    () => ({ from, to, limit: PAGE_SIZE, offset, options }),
    [from, to, offset, options],
  );

  useEffect(() => {
    if (!ctx || !reportKey) return;
    void runs; // a dependency on purpose: see `runs` above
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await reportsApi.run(ctx, reportKey, query);
        if (cancelled) return;
        setReport(res);
      } catch (e) {
        if (!cancelled) {
          setReport(null);
          setLoadError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, reportKey, query, runs]);

  // A companion report runs over the SAME dates and is re-run by the same
  // Run button, so the two halves of the screen can never disagree on period.
  const companionKey = reportKey ? REPORT_UI_HINTS[reportKey]?.companion : undefined;
  const [companion, setCompanion] = useState<ReportResponse | null>(null);
  const [companionError, setCompanionError] = useState<string | null>(null);
  // The row whose submission is open in the details view, if any.
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const closeDetails = useCallback(() => setViewing(null), []);

  useEffect(() => {
    if (!ctx || !companionKey) {
      setCompanion(null);
      return;
    }
    void runs; // a dependency on purpose: see `runs` above
    let cancelled = false;
    void (async () => {
      setCompanionError(null);
      try {
        const res = await reportsApi.run(ctx, companionKey, {
          from,
          to,
          limit: PAGE_SIZE,
          offset: 0,
          options: {},
        });
        if (!cancelled) setCompanion(res);
      } catch (e) {
        if (!cancelled) {
          setCompanion(null);
          setCompanionError((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, companionKey, from, to, runs]);

  const runExport = useCallback(
    async (format: ExportFormat) => {
      if (!ctx || !reportKey) return;
      setExporting(format);
      setActionError(null);
      setNotice(null);
      try {
        // The export applies the SAME filters, minus pagination: a downloaded
        // file that silently held only page one would be worse than useless.
        const file = await reportsApi.export(ctx, reportKey, format, { from, to, options });
        saveFile(file);
        setNotice(`Downloaded ${file.filename}`);
      } catch (e) {
        setActionError((e as Error).message);
      } finally {
        setExporting(null);
      }
    },
    [ctx, reportKey, from, to, options],
  );

  if (!ctx) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Report</h1>
        <p className={styles.notice}>Select a company and branch to run a report.</p>
      </section>
    );
  }

  const timezone = report?.timezone ?? 'UTC';
  const total = report?.meta.total ?? 0;
  const paginated = report?.kind === 'rows';
  const shown = report?.rows.length ?? 0;

  const hint = reportKey ? REPORT_UI_HINTS[reportKey] : undefined;
  const cards = report && hint ? hintedMetrics(report, hint) : undefined;

  const needle = search.trim().toLowerCase();
  const searchable = hint?.searchableColumns ?? [];
  const visibleRows = !report || !needle || searchable.length === 0
    ? report?.rows ?? []
    : report.rows.filter((row) =>
        searchable.some((key) => String(row[key] ?? '').toLowerCase().includes(needle)),
      );

  const companionHint = companionKey ? REPORT_UI_HINTS[companionKey] : undefined;
  const companionCards = companion && companionHint ? hintedMetrics(companion, companionHint) : undefined;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{report?.name ?? reportKey}</h1>
          <p className={styles.subtitle}>{report?.description}</p>
          {report ? (
            <p className={styles.zone}>
              {report.branch_name ? `${report.branch_name} · ` : ''}
              {formatDateLabel(report.filters.from)} to {formatDateLabel(report.filters.to)} · {report.timezone}
            </p>
          ) : null}
        </div>
        <Link className={styles.button} href="/reports">
          All reports
        </Link>
      </header>

      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setRuns((n) => n + 1);
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="report-from">
            From
          </label>
          <input
            id="report-from"
            className={styles.input}
            type="date"
            value={from || report?.filters.from || ''}
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="report-to">
            To
          </label>
          <input
            id="report-to"
            className={styles.input}
            type="date"
            value={to || report?.filters.to || ''}
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        {/* Filters are whatever the report declared — never a free-text box.
            One rendered as chips below is not repeated here as a dropdown. */}
        {(report?.option_specs ?? []).filter((spec) => spec.key !== hint?.chips?.optionKey).map((spec) => (
          <div className={styles.field} key={spec.key}>
            <label className={styles.label} htmlFor={`report-${spec.key}`}>
              {spec.label}
            </label>
            <select
              id={`report-${spec.key}`}
              className={styles.select}
              value={options[spec.key] ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setOptions((current) => {
                  const next = { ...current };
                  if (value) next[spec.key] = value;
                  else delete next[spec.key];
                  return next;
                });
                setOffset(0);
              }}
            >
              <option value="">{hint?.optionAllLabels?.[spec.key] ?? 'All'}</option>
              {spec.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className={styles.actions}>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={loading}>
            {loading ? 'Running…' : 'Run'}
          </button>
          {mayExport && report?.exportable !== false ? (
            <>
              <button
                type="button"
                className={styles.button}
                disabled={exporting !== null || loading}
                onClick={() => void runExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Preparing…' : 'Export Excel'}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={exporting !== null || loading}
                onClick={() => void runExport('pdf')}
              >
                {exporting === 'pdf' ? 'Preparing…' : 'Export PDF'}
              </button>
            </>
          ) : null}
        </div>
      </form>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {report ? (
        <>
          <MetricGrid metrics={cards?.metrics ?? report.metrics} timezone={timezone} icons={cards?.icons} />

          {hint?.chips ? (
            <div className={styles.chips} role="group" aria-label="Filter the log">
              {[{ value: '', label: 'All' }, ...hint.chips.values].map((chip) => {
                const optionKey = hint.chips!.optionKey;
                const selected = (options[optionKey] ?? '') === chip.value;
                return (
                  <button
                    key={chip.value || 'all'}
                    type="button"
                    className={styles.chip}
                    aria-pressed={selected}
                    onClick={() => {
                      setOptions((current) => {
                        const next = { ...current };
                        if (chip.value) next[optionKey] = chip.value;
                        else delete next[optionKey];
                        return next;
                      });
                      setOffset(0);
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {hint ? (
            <ReportPanel
              report={report}
              hint={hint}
              rows={visibleRows}
              search={search}
              onSearch={setSearch}
              onView={hint.details ? setViewing : undefined}
            />
          ) : (
            <ReportTable
              columns={report.columns}
              rows={report.rows}
              timezone={timezone}
              caption={`${report.name}, ${formatDateLabel(report.filters.from)} to ${formatDateLabel(report.filters.to)}`}
              drilldown={report.drilldown}
            />
          )}

          {paginated ? (
            <div className={styles.pagination}>
              <span className={styles.pageInfo}>
                {total === 0
                  ? 'No rows'
                  : `Showing ${offset + 1}–${offset + shown} of ${total}`}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={offset + shown >= total || loading}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          {companionError ? (
            <p className={styles.error} role="alert">
              {companionError}
            </p>
          ) : null}
          {companion && companionHint ? (
            <>
              <MetricGrid
                metrics={companionCards?.metrics ?? companion.metrics}
                timezone={companion.timezone}
                icons={companionCards?.icons}
              />
              <ReportPanel report={companion} hint={companionHint} rows={companion.rows} />
            </>
          ) : null}
        </>
      ) : null}
      {viewing && ctx && hint?.details && typeof viewing.task_id === 'string' ? (
        <ChecklistDetailsDialog
          ctx={ctx}
          taskId={viewing.task_id}
          title={hint.details.title}
          subtitle={hint.details.subtitle(viewing)}
          icon={hint.details.icon}
          tone={hint.details.tone}
          sectionLooks={hint.details.sectionLooks}
          onClose={closeDetails}
        />
      ) : null}
    </section>
  );
}

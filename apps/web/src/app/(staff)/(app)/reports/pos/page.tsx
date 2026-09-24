'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { reportsApi } from '@/lib/reports/api';
import { branchToday, formatInstant, formatMoney, formatValue } from '@/lib/reports/format';
import type { ReportMetric, ReportResponse } from '@/lib/reports/types';
import { MetricGrid } from '@/components/reports/metric-grid';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import {
  ORDER_STATUS_BADGES,
  ORDER_TYPE_COLOURS,
  ORDER_TYPE_LABELS,
  POS_ANALYTICS_ICONS,
  POS_SUMMARY_CARDS,
  POS_SUMMARY_ICONS,
  hourlySeries,
  longDateLabel,
  presetRange,
  rangeLabel,
  type AnalyticsPreset,
} from '@/lib/reports/pos-ui';
import reportStyles from '@/components/reports/reports.module.css';
import styles from '@/components/reports/pos.module.css';

type Tab = 'summary' | 'orders' | 'analytics';

const TABS: ReadonlyArray<{ key: Tab; label: string; icon: AppIconName }> = [
  { key: 'summary', label: 'Summary', icon: 'grid' },
  { key: 'orders', label: 'Orders', icon: 'receipt' },
  { key: 'analytics', label: 'Analytics', icon: 'barChart' },
];

/** A day's orders fit one page; more than this says so rather than scrolling forever. */
const ORDERS_PAGE = 100;

interface Loaded {
  reports: Record<string, ReportResponse>;
  error: string | null;
  loading: boolean;
}

/**
 * Run a set of POS reports over one window, again whenever the window, the
 * branch or `nonce` (the refresh button) changes. A failure in any of them is
 * shown once, over whatever did load.
 */
function useReports(
  ctx: { companyId: string; branchId: string } | null,
  keys: readonly string[],
  from: string | null,
  to: string | null,
  nonce: number,
  limit?: number,
): Loaded {
  const [state, setState] = useState<Loaded>({ reports: {}, error: null, loading: true });
  const keyList = keys.join(',');

  useEffect(() => {
    if (!ctx || !from || !to) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    void (async () => {
      const results = await Promise.allSettled(
        keyList.split(',').map((key) => reportsApi.run(ctx, key, { from, to, ...(limit ? { limit } : {}) })),
      );
      if (cancelled) return;
      const reports: Record<string, ReportResponse> = {};
      let error: string | null = null;
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') reports[keyList.split(',')[i]] = result.value;
        else error ??= result.reason instanceof Error ? result.reason.message : 'Could not load this report';
      });
      setState({ reports, error, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, keyList, from, to, nonce, limit]);

  return state;
}

/**
 * POS Reports — a branch's point-of-sale takings in three views: the day at a
 * glance (Summary), every order that day (Orders), and trends over a range
 * (Analytics). Everything is read from the `pos.*` reports, so the server's
 * permission check and the branch's own clock apply as for any report.
 */
export default function PosReportsPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId ? { companyId: selectedCompanyId, branchId: selectedBranchId } : null,
    [selectedCompanyId, selectedBranchId],
  );
  const timezone = selectedBranch?.timezone ?? 'UTC';
  const today = branchToday(timezone);

  const [tab, setTab] = useState<Tab>('summary');
  const [day, setDay] = useState<string | null>(null);
  const shownDay = day ?? today;
  const [preset, setPreset] = useState<AnalyticsPreset>('today');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? 'today' : preset, today);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const [dialog, setDialog] = useState<'day' | 'range' | null>(null);

  if (!ctx) {
    return (
      <section className={reportStyles.page}>
        <p className={reportStyles.empty} role="status">
          Choose a branch to see its POS reports.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/" className={styles.back} aria-label="Back">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Point of Sale</p>
          <h1 className={styles.title}>POS Reports</h1>
        </div>
        {tab !== 'analytics' ? (
          <div className={styles.tools}>
            <button type="button" className={styles.tool} aria-label="Pick a day" onClick={() => setDialog('day')}>
              <AppIcon name="calendar" size={22} />
            </button>
            <button type="button" className={styles.tool} aria-label="Today" onClick={() => setDay(null)}>
              <AppIcon name="calendarCheck" size={22} />
            </button>
            <button type="button" className={styles.tool} aria-label="Refresh" onClick={refresh}>
              <AppIcon name="refresh" size={22} />
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.tabs} role="tablist" aria-label="POS report views">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={styles.tab}
            onClick={() => setTab(t.key)}
          >
            <AppIcon name={t.icon} size={26} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        <div className={styles.rangeBar}>
          <div className={styles.chips}>
            {(
              [
                ['today', 'Today'],
                ['7d', '7 Days'],
                ['30d', '30 Days'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={styles.chip}
                aria-pressed={preset === key}
                onClick={() => setPreset(key)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={styles.chip}
              aria-pressed={preset === 'custom'}
              onClick={() => setDialog('range')}
            >
              <AppIcon name="calendar" size={16} />
              Custom
            </button>
            <button type="button" className={styles.tool} aria-label="Refresh" onClick={refresh}>
              <AppIcon name="refresh" size={20} />
            </button>
          </div>
          <p className={styles.rangeMeta}>
            <AppIcon name="calendar" size={16} />
            {rangeLabel(range.from, range.to)} · {selectedBranch?.name}
          </p>
        </div>
      ) : (
        <p className={styles.dayStrip}>
          <AppIcon name="calendar" size={22} />
          {longDateLabel(shownDay)}
        </p>
      )}

      {tab === 'summary' ? (
        <SummaryTab ctx={ctx} day={shownDay} nonce={nonce} timezone={timezone} />
      ) : tab === 'orders' ? (
        <OrdersTab ctx={ctx} day={shownDay} nonce={nonce} timezone={timezone} />
      ) : (
        <AnalyticsTab ctx={ctx} from={range.from} to={range.to} nonce={nonce} timezone={timezone} />
      )}

      {dialog ? (
        <DateDialog
          mode={dialog}
          initial={dialog === 'day' ? { from: shownDay, to: shownDay } : range}
          max={today}
          onCancel={() => setDialog(null)}
          onApply={(picked) => {
            if (dialog === 'day') setDay(picked.from === today ? null : picked.from);
            else {
              setCustom(picked);
              setPreset('custom');
            }
            setDialog(null);
          }}
        />
      ) : null}
    </section>
  );
}

type Ctx = { companyId: string; branchId: string };

function Status({ loaded }: { loaded: Loaded }) {
  if (loaded.error) {
    return (
      <p className={reportStyles.error} role="alert">
        {loaded.error}
      </p>
    );
  }
  return loaded.loading ? (
    <p className={styles.loading} role="status">
      Loading…
    </p>
  ) : null;
}

const metricOf = (report: ReportResponse | undefined, key: string): ReportMetric | undefined =>
  report?.metrics.find((m) => m.key === key);

function SummaryTab({ ctx, day, nonce, timezone }: { ctx: Ctx; day: string; nonce: number; timezone: string }) {
  const loaded = useReports(ctx, ['pos.summary'], day, day, nonce);
  const report = loaded.reports['pos.summary'];
  const revenue = metricOf(report, 'total_revenue');
  const paid = Number(metricOf(report, 'paid_orders')?.value ?? 0);
  const cards = (report?.metrics ?? []).filter((m) => (POS_SUMMARY_CARDS as readonly string[]).includes(m.key));

  return (
    <>
      <Status loaded={loaded} />
      {report ? (
        <>
          <div className={styles.hero}>
            <p className={styles.heroLabel}>Total Revenue</p>
            <p className={styles.heroValue}>{formatMoney(Number(revenue?.value ?? 0), revenue?.currency)}</p>
            <p className={styles.heroSub}>
              {paid} paid {paid === 1 ? 'order' : 'orders'}
            </p>
          </div>
          <MetricGrid metrics={cards} timezone={timezone} icons={POS_SUMMARY_ICONS} />
          <section className={styles.section} aria-labelledby="pos-payments">
            <h2 className={styles.sectionTitle} id="pos-payments">
              Payment Methods
            </h2>
            {report.rows.length === 0 ? (
              <p className={styles.quiet}>No payments recorded</p>
            ) : (
              <ul className={styles.list}>
                {report.rows.map((row) => (
                  <li key={String(row.method)} className={styles.listRow}>
                    <span className={styles.listName}>{String(row.method)}</span>
                    <span className={styles.listMeta}>
                      {Number(row.orders)} {Number(row.orders) === 1 ? 'order' : 'orders'}
                    </span>
                    <span className={styles.listAmount}>
                      {formatMoney(Number(row.amount_minor), String(row.currency))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function OrdersTab({ ctx, day, nonce, timezone }: { ctx: Ctx; day: string; nonce: number; timezone: string }) {
  const loaded = useReports(ctx, ['pos.orders'], day, day, nonce, ORDERS_PAGE);
  const report = loaded.reports['pos.orders'];

  return (
    <>
      <Status loaded={loaded} />
      {report && report.rows.length === 0 ? (
        <div className={styles.bigEmpty} role="status">
          <AppIcon name="receipt" size={72} />
          <p>No orders found</p>
        </div>
      ) : null}
      {report && report.rows.length > 0 ? (
        <>
          <ul className={styles.orders}>
            {report.rows.map((row) => {
              const status = ORDER_STATUS_BADGES[String(row.status)];
              return (
                <li key={String(row.order_number)} className={styles.order}>
                  <div className={styles.orderTop}>
                    <span className={styles.orderNumber}>#{String(row.order_number)}</span>
                    {status ? (
                      <span className={reportStyles.badge} data-tone={status.tone}>
                        {status.label}
                      </span>
                    ) : null}
                    <span className={styles.orderTotal}>
                      {formatMoney(Number(row.total_minor), String(row.currency))}
                    </span>
                  </div>
                  <p className={styles.orderMeta}>
                    {formatInstant(row.opened_at, timezone)} · {ORDER_TYPE_LABELS[String(row.order_type)] ?? String(row.order_type)}
                    {row.table_label ? ` · ${String(row.table_label)}` : ''}
                  </p>
                  <p className={styles.orderMeta}>
                    {Number(row.items)} {Number(row.items) === 1 ? 'item' : 'items'}
                    {row.payment ? ` · ${String(row.payment)}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
          {report.meta.total > report.rows.length ? (
            <p className={styles.quiet}>
              Showing the latest {report.rows.length} of {report.meta.total} orders — export the report for the rest.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

const ANALYTICS_KEYS = ['pos.analytics', 'pos.revenue_by_hour', 'pos.revenue_by_type'] as const;

function AnalyticsTab({
  ctx,
  from,
  to,
  nonce,
  timezone,
}: {
  ctx: Ctx;
  from: string;
  to: string;
  nonce: number;
  timezone: string;
}) {
  const loaded = useReports(ctx, ANALYTICS_KEYS, from, to, nonce);
  const analytics = loaded.reports['pos.analytics'];
  const byHour = loaded.reports['pos.revenue_by_hour'];
  const byType = loaded.reports['pos.revenue_by_type'];
  const currency = metricOf(analytics, 'revenue')?.currency;

  return (
    <>
      <Status loaded={loaded} />
      {analytics ? <MetricGrid metrics={analytics.metrics} timezone={timezone} icons={POS_ANALYTICS_ICONS} /> : null}
      {byHour ? <HourChart rows={byHour.rows} currency={currency} /> : null}
      {byType ? <TypeChart rows={byType.rows} currency={currency} /> : null}
      {analytics ? (
        <section className={styles.panel} aria-labelledby="pos-items">
          <h2 className={styles.panelTitle} id="pos-items">
            Items Sold
          </h2>
          {analytics.rows.length === 0 ? (
            <div className={styles.panelEmpty}>
              <AppIcon name="fork" size={40} />
              <p>No items sold in this range</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {analytics.rows.map((row) => (
                <li key={String(row.item)} className={styles.listRow}>
                  <span className={styles.listName}>{String(row.item)}</span>
                  <span className={styles.listMeta}>× {formatValue(row.quantity, 'number')}</span>
                  <span className={styles.listAmount}>
                    {formatMoney(Number(row.revenue_minor), String(row.currency))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function HourChart({ rows, currency }: { rows: ReportResponse['rows']; currency?: string }) {
  const series = hourlySeries(
    rows.map((r) => ({ hour: Number(r.hour), hour_label: String(r.hour_label), revenue_minor: Number(r.revenue_minor) })),
  );
  const peak = Math.max(1, ...series.map((s) => s.revenue));
  return (
    <section className={styles.panel} aria-labelledby="pos-by-hour">
      <h2 className={styles.panelTitle} id="pos-by-hour">
        Revenue by Hour
      </h2>
      {series.length === 0 ? (
        <div className={styles.panelEmpty}>
          <AppIcon name="barChart" size={40} />
          <p>No paid orders in this range</p>
        </div>
      ) : (
        <ol className={styles.bars}>
          {series.map((s) => (
            <li key={s.hour} className={styles.barCol} aria-label={`${s.label}: ${formatMoney(s.revenue, currency)}`}>
              <span className={styles.bar} style={{ height: `${Math.max(2, (s.revenue / peak) * 100)}%` }} />
              <span className={styles.barLabel}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TypeChart({ rows, currency }: { rows: ReportResponse['rows']; currency?: string }) {
  const slices = rows.map((r) => ({ label: String(r.order_type), revenue: Number(r.revenue_minor) }));
  const total = slices.reduce((sum, s) => sum + s.revenue, 0);
  // A ring drawn as stroked arcs on a circle of circumference 100.
  const R = 15.915;
  let offset = 0;
  return (
    <section className={styles.panel} aria-labelledby="pos-by-type">
      <h2 className={styles.panelTitle} id="pos-by-type">
        Revenue by Order Type
      </h2>
      {total === 0 ? (
        <div className={styles.panelEmpty}>
          <AppIcon name="pie" size={40} />
          <p>No paid orders in this range</p>
        </div>
      ) : (
        <div className={styles.donutWrap}>
          <svg viewBox="0 0 42 42" className={styles.donut} role="img" aria-label="Revenue by order type">
            {slices.map((s, i) => {
              const share = (s.revenue / total) * 100;
              const arc = (
                <circle
                  key={s.label}
                  cx="21"
                  cy="21"
                  r={R}
                  fill="none"
                  stroke={ORDER_TYPE_COLOURS[i % ORDER_TYPE_COLOURS.length]}
                  strokeWidth="6"
                  strokeDasharray={`${share} ${100 - share}`}
                  // Start at twelve o'clock and run clockwise.
                  strokeDashoffset={(((25 - offset) % 100) + 100) % 100}
                />
              );
              offset += share;
              return arc;
            })}
          </svg>
          <ul className={styles.legend}>
            {slices.map((s, i) => (
              <li key={s.label}>
                <span className={styles.swatch} style={{ background: ORDER_TYPE_COLOURS[i % ORDER_TYPE_COLOURS.length] }} />
                <span className={styles.listName}>{s.label}</span>
                <span className={styles.listMeta}>{Math.round((s.revenue / total) * 100)}%</span>
                <span className={styles.listAmount}>{formatMoney(s.revenue, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

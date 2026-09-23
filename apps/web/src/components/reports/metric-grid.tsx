import { formatValue } from '@/lib/reports/format';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import type { ReportMetric, WidgetMetric } from '@/lib/reports/types';
import styles from './reports.module.css';

/** An icon + colour for a metric, keyed by its `key`. Purely cosmetic: a
 *  metric with no entry here renders exactly as it always has. */
export interface MetricIcon {
  icon: AppIconName;
  tone: 'blue' | 'amber' | 'green' | 'terracotta' | 'purple' | 'red';
}

/**
 * The headline figures above a report, and the body of a dashboard tile.
 *
 * One component for both because a metric is a metric: a label, a typed value
 * and an optional emphasis. Rendering is driven entirely by the declared
 * `type`, so a report that starts emitting a new metric needs no change here.
 */
export function MetricGrid({
  metrics,
  timezone,
  icons,
}: {
  metrics: readonly (ReportMetric | WidgetMetric)[];
  timezone: string;
  /** Opt-in per-metric icon badges, keyed by metric key. */
  icons?: Readonly<Record<string, MetricIcon>>;
}) {
  if (metrics.length === 0) return null;

  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => {
        const emphasis = (metric as WidgetMetric).emphasis;
        const tone = emphasis && emphasis !== 'neutral' ? styles[emphasis] : '';
        const iconSpec = icons?.[metric.key];
        return (
          <div
            key={metric.key}
            className={`${styles.metric} ${tone} ${iconSpec ? styles.metricWithIcon : ''}`}
          >
            <div>
              <dt className={styles.metricLabel}>{metric.label}</dt>
              <dd className={styles.metricValue}>
                {formatValue(metric.value, metric.type, {
                  timezone,
                  currency: metric.currency,
                })}
              </dd>
            </div>
            {iconSpec ? (
              <span className={styles.metricIcon} data-tone={iconSpec.tone} aria-hidden="true">
                <AppIcon name={iconSpec.icon} size={20} />
              </span>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

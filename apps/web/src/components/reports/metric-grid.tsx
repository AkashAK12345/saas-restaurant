import { formatValue } from '@/lib/reports/format';
import type { ReportMetric, WidgetMetric } from '@/lib/reports/types';
import styles from './reports.module.css';

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
}: {
  metrics: readonly (ReportMetric | WidgetMetric)[];
  timezone: string;
}) {
  if (metrics.length === 0) return null;

  return (
    <dl className={styles.metrics}>
      {metrics.map((metric) => {
        const emphasis = (metric as WidgetMetric).emphasis;
        const tone = emphasis && emphasis !== 'neutral' ? styles[emphasis] : '';
        return (
          <div key={metric.key} className={`${styles.metric} ${tone}`}>
            <dt className={styles.metricLabel}>{metric.label}</dt>
            <dd className={styles.metricValue}>
              {formatValue(metric.value, metric.type, {
                timezone,
                currency: metric.currency,
              })}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

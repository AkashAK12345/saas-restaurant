import { MetricGrid } from './metric-grid';
import type { DashboardWidget } from '@/lib/reports/types';
import styles from './reports.module.css';

/**
 * One dashboard tile.
 *
 * A widget that failed says so in its own card rather than taking the page
 * down — an operator with a broken banquet tile can still read the queue.
 *
 * `live` tiles describe the here-and-now, so they say so explicitly instead of
 * letting the page's date range imply a window that was never applied.
 */
export function WidgetCard({ widget, timezone }: { widget: DashboardWidget; timezone: string }) {
  return (
    <section className={styles.widget} aria-labelledby={`widget-${widget.key}`}>
      <div className={styles.widgetHead}>
        <h3 className={styles.widgetTitle} id={`widget-${widget.key}`}>
          {widget.title}
        </h3>
        {widget.live ? <span className={styles.live}>Right now</span> : null}
      </div>

      {widget.error ? (
        <p className={styles.error} role="alert">
          {widget.error}
        </p>
      ) : (
        <MetricGrid metrics={widget.metrics} timezone={timezone} />
      )}
    </section>
  );
}

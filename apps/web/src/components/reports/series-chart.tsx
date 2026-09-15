'use client';

import { useId, useState } from 'react';
import { formatDateLabel } from '@/lib/reports/format';
import type { WidgetSeries } from '@/lib/reports/types';
import styles from './reports.module.css';

interface BranchSeries {
  id: string;
  name: string;
  series?: WidgetSeries;
}

/**
 * A per-day bar chart for a series tile, with a figure selector and — on the
 * All branches view — a branch selector.
 *
 * Accessible by construction: the bars are one labelled image summarising the
 * range and the busiest day, and the exact numbers are always available as a
 * table. Heights come only from the server's counts; nothing is interpolated
 * or smoothed.
 */
export function SeriesChart({
  series,
  title,
  branches,
}: {
  series: WidgetSeries;
  title: string;
  branches?: BranchSeries[];
}) {
  const id = useId();
  const [figure, setFigure] = useState(series.keys[0]?.key ?? '');
  const [branch, setBranch] = useState<string>('all');

  const shown = branch === 'all' ? series : (branches?.find((b) => b.id === branch)?.series ?? series);
  const label = shown.keys.find((k) => k.key === figure)?.label ?? figure;
  const values = shown.points.map((p) => p.values[figure] ?? 0);
  const max = Math.max(0, ...values);
  const busiest = shown.points[values.indexOf(max)];
  const first = shown.points[0]?.date;
  const last = shown.points[shown.points.length - 1]?.date;
  const scopeName = branch === 'all' ? '' : ` at ${branches?.find((b) => b.id === branch)?.name ?? ''}`;

  const summary =
    shown.points.length === 0
      ? `${label}: no days in this period`
      : max === 0
        ? `${label}${scopeName} per day, ${formatDateLabel(first!)} to ${formatDateLabel(last!)}: none on any day`
        : `${label}${scopeName} per day, ${formatDateLabel(first!)} to ${formatDateLabel(last!)}; highest ${max} on ${formatDateLabel(busiest!.date)}`;

  // Label a handful of dates, not all 31, so the axis stays legible on a phone.
  const step = Math.max(1, Math.ceil(shown.points.length / 6));

  return (
    <div className={styles.chart}>
      <div className={styles.actions}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-figure`}>
            Figure
          </label>
          <select id={`${id}-figure`} className={styles.select} value={figure} onChange={(e) => setFigure(e.target.value)}>
            {series.keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        {branches && branches.length > 1 ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-branch`}>
              Branch
            </label>
            <select id={`${id}-branch`} className={styles.select} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.series}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className={styles.bars} role="img" aria-label={`${title}: ${summary}`}>
        {shown.points.map((p, i) => (
          <div key={p.date} className={styles.barSlot}>
            <div
              className={styles.bar}
              style={{ height: max === 0 ? '0%' : `${Math.round(((p.values[figure] ?? 0) / max) * 100)}%` }}
              title={`${formatDateLabel(p.date)}: ${p.values[figure] ?? 0}`}
            />
            <span className={styles.barLabel} aria-hidden="true">
              {i % step === 0 ? p.date.slice(8) : ''}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.subtitle}>{summary}</p>

      <details>
        <summary>Show as table</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={`${title} by day`}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className={styles.numeric}>
                  {label}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.points.map((p) => (
                <tr key={p.date}>
                  <td>{formatDateLabel(p.date)}</td>
                  <td className={styles.numeric}>{p.values[figure] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

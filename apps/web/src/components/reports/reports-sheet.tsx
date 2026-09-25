'use client';

import { useEffect, useRef } from 'react';
import { NavIcon } from '@/components/shell/nav-icons';
import type { ChecklistReport } from '@/lib/reports/checklist-reports';
import { ReportRowContent } from './report-row';
import styles from './reports-sheet.module.css';

/**
 * The dashboard's Reports card opens this: the daily checklists a branch
 * submits, offered to read back rather than to fill in.
 *
 * Built on the same sheet as the queue's, so the two behave identically — the
 * backdrop and Escape both close it, and the first row takes focus on open.
 * The close control is present for assistive technology but not drawn, since
 * the sheet is dismissed by the backdrop or a swipe on a phone.
 */
export function ReportsSheet({
  reports,
  onSelect,
  onClose,
}: {
  reports: readonly ChecklistReport[];
  onSelect: (report: ChecklistReport) => void;
  onClose: () => void;
}) {
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItem.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.head}>
          <span className={`${styles.tile} ${styles.tileAccent}`}>
            <NavIcon name="reports" />
          </span>
          <h2 className={styles.title} id="reports-sheet-title">
            Reports
          </h2>
          <button type="button" className="sr-only" onClick={onClose}>
            Close reports
          </button>
        </div>
        <ul className={styles.list}>
          {reports.map((report, i) => (
            <li key={report.key}>
              <button
                ref={i === 0 ? firstItem : undefined}
                type="button"
                className={styles.item}
                onClick={() => onSelect(report)}
              >
                <ReportRowContent icon={report.icon} title={report.title} subtitle={report.subtitle} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

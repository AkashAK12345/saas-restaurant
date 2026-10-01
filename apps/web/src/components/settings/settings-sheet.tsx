'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavIcon } from '@/components/shell/nav-icons';
import { ReportRowContent } from '@/components/reports/report-row';
import type { SettingsEntry } from '@/lib/settings/settings-menu';
import styles from '@/components/reports/reports-sheet.module.css';

/**
 * The rows of the Settings menu — tile, title, subtitle, chevron — as links.
 * The bottom bar's sheet and the Settings page both draw this list, so the
 * two can never disagree.
 */
export function SettingsMenuList({
  entries,
  onNavigate,
  firstItemRef,
}: {
  entries: readonly SettingsEntry[];
  onNavigate?: () => void;
  firstItemRef?: React.Ref<HTMLAnchorElement>;
}) {
  return (
    <ul className={styles.list}>
      {entries.map((entry, i) => (
        <li key={entry.key}>
          <Link
            ref={i === 0 ? firstItemRef : undefined}
            href={entry.href}
            className={styles.item}
            onClick={onNavigate}
          >
            <ReportRowContent icon={entry.icon} title={entry.title} subtitle={entry.subtitle} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The phone's Settings: the bottom bar's last tab opens this sheet over the
 * current page rather than leaving it. Built on the Reports sheet, so the two
 * behave alike — the backdrop and Escape close it, the first row takes focus,
 * and choosing a row closes it on the way to that page.
 */
export function SettingsSheet({ entries, onClose }: { entries: readonly SettingsEntry[]; onClose: () => void }) {
  const firstItem = useRef<HTMLAnchorElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // The sheet floats above the bottom bar, which stays in view and usable.
  const [barHeight, setBarHeight] = useState(0);

  useLayoutEffect(() => {
    setBarHeight(backdrop.current?.closest('footer')?.offsetHeight ?? 0);
  }, []);

  useEffect(() => {
    // Focus moves into the sheet for keyboards and screen readers, without
    // drawing a ring on a row nobody has chosen yet.
    firstItem.current?.focus({ focusVisible: false } as FocusOptions);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={backdrop}
      className={`${styles.backdrop} ${styles.floating}`}
      style={{ bottom: barHeight }}
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.head}>
          <span className={`${styles.tile} ${styles.tileAmber}`}>
            <NavIcon name="settings" />
          </span>
          <h2 className={styles.title} id="settings-sheet-title">
            Settings
          </h2>
          <button type="button" className="sr-only" onClick={onClose}>
            Close settings
          </button>
        </div>
        <SettingsMenuList entries={entries} onNavigate={onClose} firstItemRef={firstItem} />
      </div>
    </div>
  );
}

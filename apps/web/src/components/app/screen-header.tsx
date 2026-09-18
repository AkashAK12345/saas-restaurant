'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BranchChip } from '@/components/shell/branch-chip';
import { AppIcon } from './icons';
import styles from './screen-chrome.module.css';

/**
 * A queue screen's header: back to Home, an optional breadcrumb, the title,
 * the branch pill and any screen actions.
 *
 * Two shapes, as in the design: with a breadcrumb the title is set in the
 * serif face and the branch pill sits on its own row; without one the title is
 * plain and shares the row with the pill.
 */
export function ScreenHeader({
  title,
  crumb,
  actions,
  plain = false,
  back = { href: '/', label: 'Back to home' },
}: {
  title: string;
  crumb?: string;
  actions?: ReactNode;
  /** With a breadcrumb: a sans title and the branch pill on the right. */
  plain?: boolean;
  /** Where the back arrow goes; Home unless the screen sits under another. */
  back?: { href: string; label: string };
}) {
  const tools = (
    <div className={`${styles.tools} ${crumb ? styles.toolsBelow : ''} ${crumb && plain ? styles.toolsEnd : ''}`}>
      <BranchChip align={crumb && !plain ? 'start' : 'end'} />
      {actions}
    </div>
  );

  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <Link href={back.href} className={`${styles.back} ${crumb ? styles.backBox : ''}`} aria-label={back.label}>
          <AppIcon name="back" />
        </Link>
        <div className={styles.titles}>
          {crumb ? <p className={styles.crumb}>{crumb}</p> : null}
          <h1 className={crumb ? (plain ? styles.titlePlain : styles.titleSerif) : styles.title}>{title}</h1>
        </div>
        {crumb ? null : tools}
      </div>
      {crumb ? tools : null}
    </header>
  );
}

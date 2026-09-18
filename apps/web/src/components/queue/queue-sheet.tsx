'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { QueueSurface } from '@/lib/queue/surfaces';
import { AppIcon } from '@/components/app/icons';
import chrome from '@/components/app/screen-chrome.module.css';
import styles from './queue-sheet.module.css';

/**
 * The queue's screens, offered from the dashboard's Queue card as a sheet.
 * Only the screens this viewer may open are listed; each page still asks the
 * API, which decides.
 */
export function QueueSheet({ surfaces, onClose }: { surfaces: readonly QueueSurface[]; onClose: () => void }) {
  const firstLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    firstLink.current?.focus();
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
        aria-labelledby="queue-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.head}>
          <h2 className={styles.title} id="queue-sheet-title">
            Queue Management
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <ul className={styles.list}>
          {surfaces.map((s, i) => (
            <li key={s.key}>
              <Link
                ref={i === 0 ? firstLink : undefined}
                href={s.href}
                className={styles.item}
                data-tone={s.tone}
                onClick={onClose}
              >
                <span className={chrome.tile} data-tone={s.tone}>
                  <AppIcon name={s.icon} size={28} />
                </span>
                <span className={styles.text}>
                  <span className={styles.itemTitle}>{s.title}</span>
                  <span className={styles.itemSub}>{s.subtitle}</span>
                </span>
                <span className={styles.chevron}>
                  <AppIcon name="chevronRight" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

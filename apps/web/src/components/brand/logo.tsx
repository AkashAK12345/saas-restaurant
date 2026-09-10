'use client';

import { useCallback, useState } from 'react';
import styles from './logo.module.css';

/**
 * The SAMCO logo.
 *
 * THE ASSET IS THE BRAND'S, not something this component draws. It loads the
 * real artwork from /brand/ and falls back to a typographic wordmark if the
 * file is absent or fails to load, so a missing asset degrades to something
 * legible rather than a broken-image icon on a podium screen.
 *
 * Two shapes:
 *   `mark` — the globe alone, for tight spaces like the top bar.
 *   `full` — the stacked lockup with the wordmark, for sign-in and displays.
 *
 * The alt text carries the company name once. Where the logo sits beside a
 * visible "SAMCO" it is marked decorative instead, so a screen reader is not
 * made to say the name twice.
 */
export type LogoVariant = 'mark' | 'full';

const SOURCE: Record<LogoVariant, string> = {
  mark: '/brand/samco-mark.png',
  full: '/brand/samco-logo.png',
};

export interface LogoProps {
  variant?: LogoVariant;
  /** Rendered height in px; width follows the artwork's own ratio. */
  height?: number;
  /** True where a visible "SAMCO" already names the brand nearby. */
  decorative?: boolean;
  className?: string;
}

export function Logo({
  variant = 'mark',
  height = 32,
  decorative = false,
  className,
}: LogoProps) {
  const [failed, setFailed] = useState(false);

  /**
   * Catches a load that failed BEFORE React was listening.
   *
   * These pages are server-rendered, so the <img> is in the initial HTML and
   * the browser starts fetching it immediately. On a full page load a missing
   * asset therefore errors during hydration — the event fires and is gone
   * before `onError` is ever attached, leaving the browser's broken-image icon
   * on screen. (A client-side navigation does not have this problem, which is
   * exactly why it went unnoticed.)
   *
   * A finished-but-failed image is `complete` with a zero natural width, so
   * checking that as soon as the node exists recovers the case `onError` cannot
   * see. `onError` still handles anything that fails afterwards.
   */
  const check = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <span
        className={`${styles.fallback} ${variant === 'full' ? styles.fallbackFull : ''} ${className ?? ''}`}
        style={{ fontSize: Math.round(height * (variant === 'full' ? 0.34 : 0.55)) }}
        aria-hidden={decorative || undefined}
      >
        <span className={styles.fallbackName}>SAMCO</span>
        {variant === 'full' ? (
          <span className={styles.fallbackTagline}>Restaurant | Banquets</span>
        ) : null}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- the intrinsic size
       is unknown until the brand asset is dropped in, and next/image would
       demand width/height or a layout shift here. */
    <img
      ref={check}
      src={SOURCE[variant]}
      alt={decorative ? '' : 'SAMCO'}
      aria-hidden={decorative || undefined}
      height={height}
      style={{ height, width: 'auto' }}
      className={`${styles.image} ${className ?? ''}`}
      onError={() => setFailed(true)}
    />
  );
}

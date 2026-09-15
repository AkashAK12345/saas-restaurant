'use client';

import { useEffect, useState } from 'react';
import styles from './display.module.css';

export type DisplayDensity = 'comfortable' | 'compact';

const DENSITY_KEY = 'samco.display.density';

/** The screen's remembered density. Per device: a wall TV and a tablet differ. */
export function readDensity(): DisplayDensity {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeDensity(value: DisplayDensity): void {
  try {
    window.localStorage.setItem(DENSITY_KEY, value);
  } catch {
    // Storage unavailable (private mode): the choice lasts until reload.
  }
}

/**
 * Wall-screen controls: full screen and display density.
 *
 * PRESENTATION ONLY. Nothing here reads or changes queue data — a paired
 * screen still has no route that mutates anything. The strip is faint until
 * hovered or focused, so it does not compete with the token numbers a room is
 * reading from across the floor.
 */
export function DisplayControls({
  density,
  onDensityChange,
}: {
  density: DisplayDensity;
  onDensityChange: (next: DisplayDensity) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  // Read once at mount. The display page renders these controls only after it
  // has resolved the device on the client, so `document` always exists here.
  const [canFullscreen] = useState(
    () => typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function',
  );

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser refused (e.g. no user gesture): nothing to do.
    }
  };

  const next: DisplayDensity = density === 'compact' ? 'comfortable' : 'compact';

  return (
    <div className={styles.controls} role="group" aria-label="Screen controls">
      <button
        type="button"
        className={styles.control}
        aria-pressed={density === 'compact'}
        onClick={() => {
          writeDensity(next);
          onDensityChange(next);
        }}
      >
        {density === 'compact' ? 'Larger text' : 'Compact'}
      </button>
      {canFullscreen ? (
        <button type="button" className={styles.control} onClick={() => void toggleFullscreen()}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      ) : null}
    </div>
  );
}

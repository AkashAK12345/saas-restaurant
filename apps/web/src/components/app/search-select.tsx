'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AppIcon } from './icons';
import styles from './search-select.module.css';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** A muted second line, e.g. what a supplier is known for. Searched too. */
  hint?: string | null;
}

/**
 * A dropdown with a search box: a pill that opens a panel listing an "all"
 * choice then every option, with a tick on the chosen one. Closes on a pick,
 * on Escape, or on a tap anywhere else — a panel that ignores taps elsewhere
 * gets stuck open on a tablet, where there is no Escape key to hand.
 *
 * `value` null means the "all" choice — or, with no `allLabel`, nothing
 * chosen yet: the pill then shows `placeholder` and offers no "all" row.
 */
export function SearchSelect({
  label,
  allLabel,
  placeholder,
  options,
  value,
  onChange,
  align = 'start',
}: {
  /** Names the control for assistive technology, e.g. "Category". */
  label: string;
  /** The "everything" choice; omit for a pick-one list. */
  allLabel?: string;
  /** Shown while nothing is chosen, when there is no "all" choice. */
  placeholder?: string;
  options: readonly SearchSelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Which edge of the pill the panel lines up with; a middle pill centres it. */
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const chosen = options.find((o) => o.value === value);
  const choose = (next: string | null) => {
    onChange(next);
    setQuery('');
    setOpen(false);
  };

  const shown = chosen?.label ?? allLabel ?? placeholder ?? '';
  const option = (optionValue: string | null, text: string, hint?: string | null) => {
    const active = optionValue === value;
    return (
      <li key={optionValue ?? '__all'}>
        <button
          type="button"
          className={`${styles.option} ${active ? styles.optionActive : ''}`}
          aria-current={active ? 'true' : undefined}
          onClick={() => choose(optionValue)}
        >
          <span className={styles.optionText}>
            {text}
            {hint ? <span className={styles.optionHint}>{hint}</span> : null}
          </span>
          {active ? <AppIcon name="check" size={20} /> : null}
        </button>
      </li>
    );
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`${label}: ${chosen?.label ?? allLabel ?? 'none chosen'}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`${styles.triggerText} ${!chosen && !allLabel ? styles.placeholder : ''}`}>{shown}</span>
        <AppIcon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open ? (
        <div id={panelId} className={`${styles.panel} ${align === 'end' ? styles.panelEnd : align === 'center' ? styles.panelCenter : ''}`} role="dialog" aria-label={label}>
          <div className={styles.searchRow}>
            <AppIcon name="search" size={18} />
            <input
              ref={searchRef}
              type="search"
              className={styles.search}
              placeholder="Search..."
              aria-label={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul className={styles.list}>
            {query.trim() || allLabel === undefined ? null : option(null, allLabel)}
            {matches.map((o) => option(o.value, o.label, o.hint))}
            {matches.length === 0 ? (
              <li className={styles.empty}>{query.trim() ? 'Nothing matches that search' : 'None yet'}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

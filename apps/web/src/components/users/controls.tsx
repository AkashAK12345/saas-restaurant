'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import styles from './users.module.css';

/**
 * A select drawn as the reference draws it: a bordered button that opens a
 * card of options, the chosen one tinted and ticked. Escape or a click
 * outside closes it.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  /** The accessible name; the visible text is the chosen option. */
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.dropdown} ref={root}>
      <button
        type="button"
        className={styles.dropdownButton}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={chosen ? undefined : styles.placeholder}>{chosen?.label ?? placeholder ?? ''}</span>
        <span className={styles.dropdownChevron}>
          <AppIcon name={open ? 'chevronUp' : 'chevronDown'} size={20} />
        </span>
      </button>
      {open ? (
        <ul className={styles.menu} role="listbox" id={listId} aria-label={label}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={styles.option}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
                {option.value === value ? <AppIcon name="check" size={22} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** An on/off switch with its name for assistive technology. */
export function Switch({
  label,
  checked,
  onChange,
  small,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className={`${styles.switch} ${small ? styles.switchSmall : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

/** Mutually exclusive choices as one row of segments (a radio group). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; icon?: AppIconName }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <AppIcon name={option.icon} size={20} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The header every User Management screen shares: back arrow and title. */
export function ScreenHeader({ title, back, children }: { title: string; back: ReactNode; children?: ReactNode }) {
  return (
    <>
      <header className={styles.header}>
        {back}
        <h1 className={styles.title}>{title}</h1>
      </header>
      {children}
    </>
  );
}

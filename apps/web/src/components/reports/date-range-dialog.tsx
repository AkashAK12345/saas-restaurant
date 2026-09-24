'use client';

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import styles from './date-range-dialog.module.css';

/**
 * "Select Date Range" — or "Select Date" for a single day. Shared by the
 * report screens that pick dates in a dialog rather than inline fields (POS
 * Reports, Purchase Reports). Escape and the backdrop cancel; Apply is off
 * until the range is whole and in order.
 */
export function DateDialog({
  mode,
  initial,
  max,
  onCancel,
  onApply,
}: {
  mode: 'day' | 'range';
  initial: { from: string; to: string };
  max: string;
  onCancel: () => void;
  onApply: (picked: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const first = useRef<HTMLInputElement>(null);
  const invalid = !from || (mode === 'range' && (!to || to < from));

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-date-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onApply({ from, to: mode === 'range' ? to : from });
        }}
      >
        <h2 className={styles.dialogTitle} id="pos-date-title">
          <AppIcon name="calendar" size={22} />
          {mode === 'range' ? 'Select Date Range' : 'Select Date'}
        </h2>
        <label className={styles.dialogField}>
          <span>{mode === 'range' ? 'From' : 'Date'}</span>
          <input ref={first} type="date" value={from} max={max} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {mode === 'range' ? (
          <label className={styles.dialogField}>
            <span>To</span>
            <input type="date" value={to} min={from} max={max} onChange={(e) => setTo(e.target.value)} />
          </label>
        ) : null}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={styles.apply} disabled={invalid}>
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

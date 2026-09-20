'use client';

import { useState } from 'react';
import type { ChecklistItem } from '@/lib/tasks/types';
import styles from './tasks.module.css';

const HINT: Record<Exclude<ChecklistItem['kind'], 'CHECK'>, string> = {
  NUMBER: 'A number, up to 3 decimals',
  TEXT: 'Your answer',
  RATING: 'Rate 1 (poor) to 5 (excellent)',
  DATE: 'A date',
  TIME: 'A 24-hour time',
  YES_NO: 'Yes or No',
  // Unreachable in practice: PHOTO items render <ChecklistPhotoField> instead
  // of this component. Present only so this map stays exhaustive.
  PHOTO: 'A photo',
};

/**
 * One typed checklist item: a number, text, rating or date answer.
 *
 * The answer is what marks the item done. The browser checks the shape as a
 * courtesy; the server validates and canonicalises it (checklist-values.ts)
 * and is the only judge. A saved answer is shown with the way to change or
 * clear it.
 */
export function ChecklistAnswer({
  item,
  disabled,
  onSave,
  onClear,
}: {
  item: ChecklistItem;
  disabled: boolean;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(item.value ?? '');
  const id = `ans-${item.id}`;
  const kind = item.kind === 'CHECK' ? 'TEXT' : item.kind;
  const trimmed = draft.trim();
  const shapeOk =
    trimmed !== '' &&
    (kind !== 'NUMBER' || /^-?\d{1,12}(\.\d{1,3})?$/.test(trimmed)) &&
    (kind !== 'RATING' || /^[1-5]$/.test(trimmed)) &&
    (kind !== 'YES_NO' || trimmed === 'YES' || trimmed === 'NO');
  const unchanged = item.is_done && trimmed === (item.value ?? '');

  return (
    <form
      className={styles.answer}
      onSubmit={(e) => {
        e.preventDefault();
        if (shapeOk && !unchanged) onSave(trimmed);
      }}
    >
      <label className={styles.itemLabel} htmlFor={id}>
        {item.label}
        {item.is_required ? (
          <span className={styles.required} title="Required">
            {' '}
            *
          </span>
        ) : null}
        {item.is_done ? (
          <span className={styles.answered}>
            {' '}
            · answered {kind === 'YES_NO' ? (item.value === 'YES' ? 'Yes' : 'No') : item.value}
          </span>
        ) : null}
      </label>
      {kind === 'YES_NO' ? (
        <select id={id} className={styles.select} value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)}>
          <option value="">Yes or No…</option>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </select>
      ) : kind === 'RATING' ? (
        <select id={id} className={styles.select} value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)}>
          <option value="">Rate…</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={styles.input}
          type={kind === 'DATE' ? 'date' : kind === 'TIME' ? 'time' : 'text'}
          inputMode={kind === 'NUMBER' ? 'decimal' : undefined}
          maxLength={kind === 'TEXT' ? 1000 : 20}
          placeholder={HINT[kind]}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <button type="submit" className={styles.action} disabled={disabled || !shapeOk || unchanged}>
        {item.is_done ? 'Update' : 'Save'}
      </button>
      {item.is_done ? (
        <button
          type="button"
          className={styles.action}
          disabled={disabled}
          aria-label={`Clear the answer for ${item.label}`}
          onClick={() => {
            setDraft('');
            onClear();
          }}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}

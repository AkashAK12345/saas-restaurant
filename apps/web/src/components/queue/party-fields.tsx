'use client';

import styles from './party-fields.module.css';

/**
 * The party, entered as adults and kids.
 *
 * Split rather than a single total because it is a different seating problem:
 * two adults and two children need a high chair and a bigger table, not a
 * table for four. The TOTAL is never entered — the server derives it from
 * these two, so the screen cannot send a total that disagrees with the split.
 *
 * Steppers and a number input both, because a podium is used one-handed in a
 * hurry (tap) and a register desk is used with a keyboard (type).
 */
export const MAX_PARTY = 100;

export interface PartyValue {
  adults: number;
  kids: number;
}

function Stepper({
  id,
  label,
  value,
  min,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(MAX_PARTY, Math.max(min, n));

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= min}
        >
          −
        </button>
        <input
          id={id}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={min}
          max={MAX_PARTY}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const n = Number.parseInt(event.target.value, 10);
            onChange(Number.isFinite(n) ? clamp(n) : min);
          }}
        />
        <button
          type="button"
          className={styles.step}
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || value >= MAX_PARTY}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function PartyFields({
  value,
  onChange,
  disabled,
}: {
  value: PartyValue;
  onChange: (next: PartyValue) => void;
  disabled?: boolean;
}) {
  const total = value.adults + value.kids;

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Party</legend>
      <div className={styles.row}>
        <Stepper
          id="party-adults"
          label="Adults"
          value={value.adults}
          min={1}
          disabled={disabled}
          onChange={(adults) => onChange({ ...value, adults })}
        />
        <Stepper
          id="party-kids"
          label="Kids"
          value={value.kids}
          min={0}
          disabled={disabled}
          onChange={(kids) => onChange({ ...value, kids })}
        />
      </div>
      {/* The derived total, shown so the host can sanity-check it — and
          announced, because the number that matters is not one they typed. */}
      <p className={styles.total} aria-live="polite">
        {total} {total === 1 ? 'guest' : 'guests'} in total
        {total > MAX_PARTY ? ' — too large for the queue' : ''}
      </p>
    </fieldset>
  );
}

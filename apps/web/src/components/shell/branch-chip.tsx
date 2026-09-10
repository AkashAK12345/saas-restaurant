'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import styles from './branch-chip.module.css';

/**
 * The company/branch selector, as a chip.
 *
 * It replaces a pair of bare <select>s with the control the design calls for:
 * initials, the branch name, a chevron, and a sheet listing what this user can
 * actually reach. The LIST IS THE SERVER'S — `branches` comes from
 * /auth/context, which returns only the branches this user has a role at, so
 * the chip can never offer somewhere they would then be refused.
 *
 * Selecting a branch is still just context: every request re-proves access.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function BranchChip() {
  const ctx = useAppContext();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // A dropdown that ignores a click elsewhere is a dropdown that gets stuck
  // open on a tablet, where there is no Escape key to hand.
  useEffect(() => {
    if (!open) return;
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

  const company = ctx.companies.find((c) => c.id === ctx.selectedCompanyId) ?? null;
  const branch = ctx.selectedBranch;
  const selection = branch?.name ?? company?.name ?? null;
  const label = selection ?? 'Select a branch';
  // Initials of a placeholder would read as a real place ("SB"), so nothing is
  // selected shows a neutral mark instead.
  const mark = selection ? initials(selection) : '··';

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.chip}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={ctx.loading}
      >
        <span className={styles.avatar} aria-hidden="true">
          {mark}
        </span>
        <span className={styles.name}>{label}</span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.sheet} role="dialog" aria-label="Choose company and branch">
          <div className={styles.group}>
            <label className={styles.groupLabel} htmlFor="chip-company">
              Company
            </label>
            <select
              id="chip-company"
              className={styles.select}
              value={ctx.selectedCompanyId ?? ''}
              onChange={(event) => ctx.selectCompany(event.target.value || null)}
            >
              <option value="">Select company…</option>
              {ctx.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.group}>
            <span className={styles.groupLabel}>Branch</span>
            {ctx.branches.length === 0 ? (
              <p className={styles.empty}>No branches available here.</p>
            ) : (
              <ul className={styles.list}>
                {ctx.branches.map((b) => {
                  const active = b.id === ctx.selectedBranchId;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={`${styles.option} ${active ? styles.optionActive : ''}`}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          ctx.selectBranch(b.id);
                          setOpen(false);
                        }}
                      >
                        <span className={styles.optionAvatar} aria-hidden="true">
                          {initials(b.name)}
                        </span>
                        <span className={styles.optionText}>
                          <span className={styles.optionName}>{b.name}</span>
                          <span className={styles.optionZone}>{b.timezone}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

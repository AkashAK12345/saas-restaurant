'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { AppIcon } from '@/components/app/icons';
import styles from './branch-chip.module.css';

/**
 * The branch selector, as a pill.
 *
 * A building mark, the current choice, a chevron, and a panel listing what
 * this user can actually reach: "All Branches" first, then the branches, with
 * a tick on the current one and a search box once the list grows.
 *
 * The context provider selects the user's company, and this pill chooses among
 * its branches. Only someone in several companies (the owner) also sees a
 * company picker here.
 *
 * THE LIST IS THE SERVER'S — `branches` comes from /auth/context, which
 * returns only the branches this user holds a role at, so the pill can never
 * offer somewhere they would then be refused. Selecting one is still just
 * context: every request re-proves access.
 *
 * "All Branches" means no branch is selected. The dashboard then shows the
 * company total, summed branch by branch by the server; the branch-scoped
 * screens ask for a branch, because a queue token or a booking belongs to one.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const ALL_BRANCHES = 'All Branches';
/** Below this many branches a search box is more clutter than help. */
const SEARCH_FROM = 4;

function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function BranchChip({ align = 'end' }: { align?: 'start' | 'end' }) {
  const ctx = useAppContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
  const branch = ctx.selectedBranch;
  const label = branch?.name ?? (ctx.branches.length > 0 ? ALL_BRANCHES : 'Select a branch');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ctx.branches.filter((b) => b.name.toLowerCase().includes(q)) : ctx.branches;
  }, [ctx.branches, query]);

  const choose = (branchId: string | null) => {
    ctx.selectBranch(branchId);
    setQuery('');
    setOpen(false);
  };

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
        <span className={styles.mark} aria-hidden="true">
          <AppIcon name="building" size={20} />
        </span>
        <span className={styles.name}>{label}</span>
        <span className={styles.chevron} aria-hidden="true">
          <AppIcon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
        </span>
      </button>

      {open ? (
        <div
          className={`${styles.sheet} ${align === 'start' ? styles.sheetStart : styles.sheetEnd}`}
          role="dialog"
          aria-label="Choose branch"
        >

          {/* Almost everyone belongs to one company and never sees this. Someone
              in several (the owner, with central control) switches here. */}
          {ctx.companies.length > 1 ? (
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
                {ctx.companies.map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {ctx.branches.length >= SEARCH_FROM ? (
            <div className={styles.searchRow}>
              <span className={styles.searchIcon} aria-hidden="true">
                <AppIcon name="search" size={18} />
              </span>
              <input
                type="search"
                className={styles.search}
                placeholder="Search…"
                aria-label="Search branches"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          {ctx.branches.length === 0 ? (
            <p className={styles.empty}>No branches available here.</p>
          ) : (
            <ul className={styles.list}>
              <li>
                <button
                  type="button"
                  className={`${styles.option} ${!ctx.selectedBranchId ? styles.optionActive : ''}`}
                  aria-current={!ctx.selectedBranchId ? 'true' : undefined}
                  onClick={() => choose(null)}
                >
                  <span className={styles.optionText}>
                    <span className={styles.optionName}>{ALL_BRANCHES}</span>
                  </span>
                  {!ctx.selectedBranchId ? (
                    <span className={styles.tick}>
                      <Tick />
                    </span>
                  ) : null}
                </button>
              </li>
              {matches.map((b) => {
                const active = b.id === ctx.selectedBranchId;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={`${styles.option} ${active ? styles.optionActive : ''}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => choose(b.id)}
                    >
                      <span className={styles.optionAvatar} aria-hidden="true">
                        {initials(b.name)}
                      </span>
                      <span className={styles.optionText}>
                        <span className={styles.optionName}>{b.name}</span>
                        <span className={styles.optionZone}>{b.timezone}</span>
                      </span>
                      {active ? (
                        <span className={styles.tick}>
                          <Tick />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {matches.length === 0 ? (
                <li className={styles.empty}>No branch matches that search.</li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

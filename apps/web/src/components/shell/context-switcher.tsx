'use client';

import { useAppContext } from '@/lib/context/app-context-provider';
import styles from './context-switcher.module.css';

/**
 * Company / branch pickers. What is offered comes from /auth/context, i.e.
 * from the server's view of the user's ACTIVE memberships. A disabled company
 * or branch is still listed (with its status) so the user can see why things
 * are unavailable, exactly mirroring the API's own listing behaviour.
 */
export function ContextSwitcher() {
  const { companies, branches, selectedCompanyId, selectedBranchId, selectCompany, selectBranch, loading } =
    useAppContext();

  return (
    <div className={styles.wrap}>
      <label className={styles.field}>
        <span className={styles.label}>Company</span>
        <select
          className={styles.select}
          value={selectedCompanyId ?? ''}
          onChange={(e) => selectCompany(e.target.value || null)}
          disabled={loading || companies.length === 0}
          aria-label="Company"
        >
          <option value="">Select company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status !== 'ACTIVE' ? ` (${c.status.toLowerCase()})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Branch</span>
        <select
          className={styles.select}
          value={selectedBranchId ?? ''}
          onChange={(e) => selectBranch(e.target.value || null)}
          disabled={loading || !selectedCompanyId || branches.length === 0}
          aria-label="Branch"
        >
          <option value="">{selectedCompanyId ? 'Select branch…' : 'Select a company first'}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.status !== 'ACTIVE' ? ' (inactive)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

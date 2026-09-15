'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { settingsApi, type BranchRecord } from '@/lib/settings/api';
import styles from '@/components/settings/settings.module.css';

/** GST slabs a banquet bill may use, in basis points. 0 is no-GST mode. */
const GST_RATES = [
  { bps: 0, label: 'No GST' },
  { bps: 500, label: '5% (CGST 2.5% + SGST 2.5%)' },
  { bps: 1200, label: '12% (CGST 6% + SGST 6%)' },
  { bps: 1800, label: '18% (CGST 9% + SGST 9%)' },
  { bps: 2800, label: '28% (CGST 14% + SGST 14%)' },
];

const rateLabel = (bps: number) => GST_RATES.find((r) => r.bps === bps)?.label ?? `${bps / 100}%`;

interface Form {
  name: string;
  gstin: string;
  fssai_license: string;
  banquet_gst_rate_bps: number;
  banquet_terms: string;
}

/** The API and the database refuse more than this. */
const TERMS_MAX = 4000;
const DEFAULT_ZONE = 'Asia/Kolkata';

/** IANA zones the browser knows, for the new-branch picker. The API validates the choice. */
function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_ZONE, 'UTC'];
  }
}

/**
 * Company and branch settings: the company's name, its branches (add, rename,
 * activate or deactivate), and each branch's statutory settings — the GSTIN
 * and FSSAI licence printed on banquet bills, the GST rate new banquet
 * bookings snapshot, and the bill's terms and conditions.
 *
 * Changing the rate never re-prices an existing booking — each keeps the rate
 * it was made with. Formats are checked here as a courtesy and by the API and
 * the database as the rule. Every control follows a permission the API
 * re-checks: branches.create, branches.update, companies.update.
 */
export default function BranchSettingsPage() {
  const { selectedCompanyId, companyPermissions, companies, reload } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'branches.view');
  const mayEdit = hasPermission(companyPermissions, 'branches.update');
  const mayCreate = hasPermission(companyPermissions, 'branches.create');
  const mayRenameCompany = hasPermission(companyPermissions, 'companies.update');

  const [branches, setBranches] = useState<BranchRecord[] | null>(null);
  // Two slots on purpose: an action is always followed by a reload, and that
  // reload succeeding must not erase the reason the action failed.
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ name: '', gstin: '', fssai_license: '', banquet_gst_rate_bps: 0, banquet_terms: '' });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', timezone: DEFAULT_ZONE });
  const [renamingCompany, setRenamingCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => timeZones(), []);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      setBranches(await settingsApi.branches(selectedCompanyId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load branches');
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1>Branches</h1>
        <p className={styles.notice}>Select a company first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Branches</h1>
        <p className={styles.notice}>You do not have access to branch settings.</p>
      </section>
    );
  }

  const company = companies?.find((c) => c.id === selectedCompanyId) ?? null;
  const gstinValid = form.gstin.trim() === '' || /^[0-9]{2}[A-Z0-9]{13}$/.test(form.gstin.trim().toUpperCase());
  const fssaiValid = form.fssai_license.trim() === '' || /^[0-9]{14}$/.test(form.fssai_license.trim());
  const nameValid = form.name.trim() !== '';

  /** Run a change, then reload the list and the shell's company/branch context. */
  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      await load();
      try {
        await reload?.();
      } catch {
        // The list above is already current; the header catches up on its next load.
      }
      setBusy(false);
    }
  };

  const save = async (branch: BranchRecord) => {
    const name = form.name.trim();
    const ok = await run(
      () =>
        settingsApi.updateBranch(selectedCompanyId, branch.id, {
          // Only a changed name is sent, so the audit trail records exactly that.
          ...(name !== branch.name ? { name } : {}),
          gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : null,
          fssai_license: form.fssai_license.trim() || null,
          banquet_gst_rate_bps: form.banquet_gst_rate_bps,
          banquet_terms: form.banquet_terms.trim() || null,
        }),
      `Saved ${name}. New banquet bookings use ${rateLabel(form.banquet_gst_rate_bps)}.`,
      'Could not save the branch',
    );
    if (ok) setEditing(null);
  };

  return (
    <section className={styles.page}>
      <header>
        <h1>Branches</h1>
        <p className={styles.intro}>
          The company, its branches, and the tax details printed on banquet bills. A rate change applies to
          bookings made after it; existing bookings keep the rate they were made with.
        </p>
      </header>

      {actionError ? (
        <p role="alert" className={styles.error}>
          {actionError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {company ? (
        <div className={styles.card} role="region" aria-label="Company">
          <div className={styles.cardTop}>
            <span className={styles.title}>{company.name}</span>
            <span className={styles.badge}>{company.status === 'ACTIVE' ? 'Active' : company.status}</span>
            <span className={styles.spacer} />
            {mayRenameCompany && !renamingCompany ? (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => {
                  setCompanyName(company.name);
                  setRenamingCompany(true);
                }}
              >
                Rename company
              </button>
            ) : null}
          </div>
          {renamingCompany ? (
            <form
              className={styles.bar}
              onSubmit={(e) => {
                e.preventDefault();
                const name = companyName.trim();
                if (!name) return;
                void (async () => {
                  const ok = await run(
                    () => settingsApi.updateCompany(selectedCompanyId, { name }),
                    `Company renamed to ${name}.`,
                    'Could not rename the company',
                  );
                  if (ok) setRenamingCompany(false);
                })();
              }}
            >
              <div className={styles.field}>
                <label className={styles.label} htmlFor="company-name">
                  Company name
                </label>
                <input
                  id="company-name"
                  className={styles.input}
                  maxLength={200}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !companyName.trim()}>
                Save name
              </button>
              <button type="button" className={styles.button} onClick={() => setRenamingCompany(false)}>
                Cancel
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {mayCreate ? (
        adding ? (
          <form
            className={`${styles.card} ${styles.bar}`}
            aria-label="New branch"
            onSubmit={(e) => {
              e.preventDefault();
              const name = draft.name.trim();
              if (!name) return;
              void (async () => {
                const ok = await run(
                  () => settingsApi.createBranch(selectedCompanyId, { name, timezone: draft.timezone }),
                  `Added branch ${name}.`,
                  'Could not add the branch',
                );
                if (ok) {
                  setAdding(false);
                  setDraft({ name: '', timezone: DEFAULT_ZONE });
                }
              })();
            }}
          >
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-branch-name">
                New branch name
              </label>
              <input
                id="new-branch-name"
                className={styles.input}
                maxLength={200}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-branch-zone">
                Time zone
              </label>
              <select
                id="new-branch-zone"
                className={styles.select}
                value={draft.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
              >
                {(zones.includes(draft.timezone) ? zones : [draft.timezone, ...zones]).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !draft.name.trim()}>
              Add
            </button>
            <button type="button" className={styles.button} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <p className={styles.meta}>
              The time zone decides every branch-local date: routines, reports, the kitchen day. Choose it carefully.
            </p>
          </form>
        ) : (
          <div className={styles.bar}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy}
              onClick={() => {
                setAdding(true);
                setNotice(null);
              }}
            >
              Add branch
            </button>
          </div>
        )
      ) : null}

      {branches === null ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading branches…
          </p>
        )
      ) : branches.length === 0 ? (
        <p className={styles.notice}>This company has no branches.</p>
      ) : (
        <ul className={styles.list}>
          {branches.map((b) => (
            <li key={b.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.title}>{b.name}</span>
                <span className={styles.badge}>{b.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>
                <span className={styles.meta}>{b.timezone}</span>
                <span className={styles.spacer} />
                {mayEdit && editing !== b.id ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    aria-label={`Edit tax details for ${b.name}`}
                    onClick={() => {
                      setForm({
                        name: b.name,
                        gstin: b.gstin ?? '',
                        fssai_license: b.fssai_license ?? '',
                        banquet_gst_rate_bps: b.banquet_gst_rate_bps,
                        banquet_terms: b.banquet_terms ?? '',
                      });
                      setEditing(b.id);
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                {mayEdit && confirmStatus !== b.id ? (
                  <button
                    type="button"
                    className={`${styles.button} ${b.status === 'ACTIVE' ? styles.danger : ''}`}
                    disabled={busy}
                    onClick={() => setConfirmStatus(b.id)}
                  >
                    {b.status === 'ACTIVE' ? `Deactivate ${b.name}` : `Activate ${b.name}`}
                  </button>
                ) : null}
              </div>
              <div className={styles.meta}>
                GSTIN: {b.gstin ?? 'Not set'} · FSSAI: {b.fssai_license ?? 'Not set'} · Banquet GST:{' '}
                {rateLabel(b.banquet_gst_rate_bps)} · Bill terms:{' '}
                {b.banquet_terms ? `${b.banquet_terms.length} characters` : 'Not set'}
              </div>

              {confirmStatus === b.id ? (
                <div className={styles.bar} role="group" aria-label={`Confirm status change for ${b.name}`}>
                  <span>
                    {b.status === 'ACTIVE'
                      ? `Deactivate ${b.name}? Nobody can work at this branch until it is activated again.`
                      : `Activate ${b.name}? Staff with roles there can work at it again.`}
                  </span>
                  <button
                    type="button"
                    className={`${styles.button} ${b.status === 'ACTIVE' ? styles.danger : styles.primary}`}
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        const next = b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                        await run(
                          () => settingsApi.updateBranch(selectedCompanyId, b.id, { status: next }),
                          `${b.name} is now ${next === 'ACTIVE' ? 'active' : 'inactive'}.`,
                          'Could not change the branch status',
                        );
                        setConfirmStatus(null);
                      })()
                    }
                  >
                    {b.status === 'ACTIVE' ? 'Yes, deactivate' : 'Yes, activate'}
                  </button>
                  <button type="button" className={styles.button} onClick={() => setConfirmStatus(null)}>
                    Keep as it is
                  </button>
                </div>
              ) : null}

              {editing === b.id ? (
                <form
                  className={styles.bar}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (gstinValid && fssaiValid && nameValid) void save(b);
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`name-${b.id}`}>
                      Branch name
                    </label>
                    <input
                      id={`name-${b.id}`}
                      className={styles.input}
                      maxLength={200}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      aria-invalid={!nameValid}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`gstin-${b.id}`}>
                      GSTIN
                    </label>
                    <input
                      id={`gstin-${b.id}`}
                      className={styles.input}
                      maxLength={15}
                      value={form.gstin}
                      onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                      aria-invalid={!gstinValid}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`fssai-${b.id}`}>
                      FSSAI licence number
                    </label>
                    <input
                      id={`fssai-${b.id}`}
                      className={styles.input}
                      inputMode="numeric"
                      maxLength={14}
                      value={form.fssai_license}
                      onChange={(e) => setForm({ ...form, fssai_license: e.target.value })}
                      aria-invalid={!fssaiValid}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`gst-${b.id}`}>
                      GST on new banquet bookings
                    </label>
                    <select
                      id={`gst-${b.id}`}
                      className={styles.select}
                      value={form.banquet_gst_rate_bps}
                      onChange={(e) => setForm({ ...form, banquet_gst_rate_bps: Number(e.target.value) })}
                    >
                      {GST_RATES.map((r) => (
                        <option key={r.bps} value={r.bps}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field} style={{ flexBasis: '100%' }}>
                    <label className={styles.label} htmlFor={`terms-${b.id}`}>
                      Terms and conditions on banquet bills
                    </label>
                    <textarea
                      id={`terms-${b.id}`}
                      className={styles.input}
                      rows={6}
                      maxLength={TERMS_MAX}
                      value={form.banquet_terms}
                      onChange={(e) => setForm({ ...form, banquet_terms: e.target.value })}
                    />
                    <span className={styles.meta}>
                      {form.banquet_terms.length} of {TERMS_MAX} characters. Printed at the foot of every bill and
                      quotation from this branch.
                    </span>
                  </div>
                  {!nameValid ? <p className={styles.meta}>A branch needs a name.</p> : null}
                  {!gstinValid ? <p className={styles.meta}>A GSTIN is 15 characters, e.g. 27AAPFU0939F1ZV.</p> : null}
                  {!fssaiValid ? <p className={styles.meta}>An FSSAI licence number is 14 digits.</p> : null}
                  <button
                    type="submit"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={busy || !gstinValid || !fssaiValid || !nameValid}
                  >
                    Save
                  </button>
                  <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
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
  gstin: string;
  fssai_license: string;
  banquet_gst_rate_bps: number;
}

/**
 * Branch statutory settings: the GSTIN and FSSAI licence printed on banquet
 * bills, and the GST rate new banquet bookings snapshot.
 *
 * Changing the rate never re-prices an existing booking — each keeps the rate
 * it was made with. Formats are checked here as a courtesy and by the API and
 * the database as the rule.
 */
export default function BranchSettingsPage() {
  const { selectedCompanyId, companyPermissions } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'branches.view');
  const mayEdit = hasPermission(companyPermissions, 'branches.update');

  const [branches, setBranches] = useState<BranchRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ gstin: '', fssai_license: '', banquet_gst_rate_bps: 0 });
  const [busy, setBusy] = useState(false);

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

  const gstinValid = form.gstin.trim() === '' || /^[0-9]{2}[A-Z0-9]{13}$/.test(form.gstin.trim().toUpperCase());
  const fssaiValid = form.fssai_license.trim() === '' || /^[0-9]{14}$/.test(form.fssai_license.trim());

  const save = async (branch: BranchRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await settingsApi.updateBranch(selectedCompanyId, branch.id, {
        gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : null,
        fssai_license: form.fssai_license.trim() || null,
        banquet_gst_rate_bps: form.banquet_gst_rate_bps,
      });
      setEditing(null);
      setNotice(`Saved ${branch.name}. New banquet bookings use ${rateLabel(form.banquet_gst_rate_bps)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the branch');
    } finally {
      await load();
      setBusy(false);
    }
  };

  return (
    <section className={styles.page}>
      <header>
        <h1>Branches</h1>
        <p className={styles.intro}>
          Tax details printed on banquet bills. A rate change applies to bookings made after it; existing
          bookings keep the rate they were made with.
        </p>
      </header>

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
                        gstin: b.gstin ?? '',
                        fssai_license: b.fssai_license ?? '',
                        banquet_gst_rate_bps: b.banquet_gst_rate_bps,
                      });
                      setEditing(b.id);
                    }}
                  >
                    Edit
                  </button>
                ) : null}
              </div>
              <div className={styles.meta}>
                GSTIN: {b.gstin ?? 'Not set'} · FSSAI: {b.fssai_license ?? 'Not set'} · Banquet GST:{' '}
                {rateLabel(b.banquet_gst_rate_bps)}
              </div>

              {editing === b.id ? (
                <form
                  className={styles.bar}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (gstinValid && fssaiValid) void save(b);
                  }}
                >
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
                  {!gstinValid ? <p className={styles.meta}>A GSTIN is 15 characters, e.g. 27AAPFU0939F1ZV.</p> : null}
                  {!fssaiValid ? <p className={styles.meta}>An FSSAI licence number is 14 digits.</p> : null}
                  <button
                    type="submit"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={busy || !gstinValid || !fssaiValid}
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

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import {
  adminApi,
  DEVICE_KIND_LABEL,
  type DisplayDeviceKind,
  type DisplayDeviceRecord,
} from '@/lib/admin/api';
import { formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';
import admin from '@/components/admin/admin.module.css';

const PAGE_SIZE = 25;

const SCREEN_PATH: Record<DisplayDeviceKind, string> = {
  QUEUE_CUSTOMER: '/display/queue',
  QUEUE_ADMIN: '/display/queue',
  BANQUET_CHEF: '/display/banquet',
};

/**
 * Wall and kitchen screens paired to the selected branch.
 *
 * PAIRING CODE, ONCE. Pairing mints a credential the screen keeps; the API
 * stores only its hash and returns the code in the creation response alone.
 * This page holds it in memory just long enough to show it, never persists it,
 * and forgets it on "Done" or on leaving the page. A lost code is not
 * recoverable by design: revoke the screen and pair it again.
 */
export default function DisplaysPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const mayView = hasPermission(branchPermissions, 'display_devices.view');
  const mayCreate = hasPermission(branchPermissions, 'display_devices.create');
  const mayRevoke = hasPermission(branchPermissions, 'display_devices.revoke');

  const [offset, setOffset] = useState(0);
  const [devices, setDevices] = useState<{ data: DisplayDeviceRecord[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ name: string; kind: DisplayDeviceKind }>({ name: '', kind: 'QUEUE_CUSTOMER' });
  const [paired, setPaired] = useState<{ device: DisplayDeviceRecord; credential: string } | null>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompanyId || !selectedBranchId) return;
    try {
      const res = await adminApi.displayDevices(selectedCompanyId, selectedBranchId, { limit: PAGE_SIZE, offset });
      setDevices({ data: res.data, total: res.meta.total });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load screens');
    }
  }, [selectedCompanyId, selectedBranchId, offset]);

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  if (!selectedCompanyId || !selectedBranchId) {
    return (
      <section className={styles.page}>
        <h1>Displays</h1>
        <p className={styles.notice}>Select a branch first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Displays</h1>
        <p className={styles.notice}>You do not have access to display screens at this branch.</p>
      </section>
    );
  }

  const pair = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi.createDisplayDevice(selectedCompanyId, selectedBranchId, {
        name: form.name.trim(),
        kind: form.kind,
      });
      setPaired(res);
      setCopied('idle');
      setAdding(false);
      setOffset(0);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pair the screen');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: DisplayDeviceRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.revokeDisplayDevice(selectedCompanyId, selectedBranchId, device.id);
      setConfirming(null);
      setNotice(`${device.name} is revoked. Its screen stops at once and its code can never pair again.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the screen');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };

  const to = devices ? offset + devices.data.length : 0;

  return (
    <section className={styles.page}>
      <header>
        <h1>Displays</h1>
        <p className={styles.intro}>
          Queue and kitchen screens paired to {selectedBranch?.name ?? 'this branch'}. A screen sees only its own
          branch and only what its kind allows.
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

      {paired ? (
        <div className={styles.card} role="region" aria-label="Pairing code">
          <h2 className={styles.title}>Pairing code for {paired.device.name}</h2>
          <p className={styles.meta}>
            On the screen, open <strong>{SCREEN_PATH[paired.device.kind]}</strong> and enter this code. It is shown
            once only and cannot be retrieved again. If it is lost, revoke this screen and pair a new one.
          </p>
          <code className={admin.secret} aria-label="One-time pairing code">
            {paired.credential}
          </code>
          <div className={styles.bar}>
            <button type="button" className={styles.button} onClick={() => void copy(paired.credential)}>
              Copy code
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => {
                setPaired(null);
                setCopied('idle');
              }}
            >
              Done — hide the code
            </button>
            {copied === 'copied' ? <span role="status">Copied.</span> : null}
            {copied === 'failed' ? <span role="status">Copying is blocked here; select the code instead.</span> : null}
          </div>
        </div>
      ) : null}

      {mayCreate ? (
        adding ? (
          <form
            className={`${styles.card} ${styles.bar}`}
            onSubmit={(e) => {
              e.preventDefault();
              if (form.name.trim()) void pair();
            }}
          >
            <div className={styles.field}>
              <label className={styles.label} htmlFor="device-name">
                Screen name
              </label>
              <input
                id="device-name"
                className={styles.input}
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="device-kind">
                Kind
              </label>
              <select
                id="device-kind"
                className={styles.select}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as DisplayDeviceKind })}
              >
                {(Object.keys(DEVICE_KIND_LABEL) as DisplayDeviceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {DEVICE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !form.name.trim()}>
              Pair screen
            </button>
            <button type="button" className={styles.button} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className={styles.bar}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy}
              onClick={() => {
                setForm({ name: '', kind: 'QUEUE_CUSTOMER' });
                setAdding(true);
                setNotice(null);
              }}
            >
              Pair a screen
            </button>
          </div>
        )
      ) : null}

      {devices === null ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading screens…
          </p>
        )
      ) : devices.data.length === 0 ? (
        <p className={styles.notice}>No screens are paired to this branch.</p>
      ) : (
        <>
          <ul className={styles.list} aria-label="Display screens">
            {devices.data.map((d) => (
              <li key={d.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.title}>{d.name}</span>
                  <span className={styles.badge}>{d.status === 'ACTIVE' ? 'Active' : 'Revoked'}</span>
                  <span className={styles.meta}>{DEVICE_KIND_LABEL[d.kind]}</span>
                  <span className={styles.spacer} />
                  {mayRevoke && d.status === 'ACTIVE' && confirming !== d.id ? (
                    <button
                      type="button"
                      className={`${styles.button} ${styles.danger}`}
                      disabled={busy}
                      aria-label={`Revoke ${d.name}`}
                      onClick={() => setConfirming(d.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
                <div className={styles.meta}>
                  Paired {formatDateTime(d.created_at)}
                  {d.revoked_at ? ` · Revoked ${formatDateTime(d.revoked_at)}` : ''}
                </div>
                {confirming === d.id ? (
                  <div className={styles.bar} role="group" aria-label={`Confirm revoking ${d.name}`}>
                    <span>Revoke {d.name}? The screen goes blank at once. This cannot be undone.</span>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.danger}`}
                      disabled={busy}
                      onClick={() => void revoke(d)}
                    >
                      Yes, revoke
                    </button>
                    <button type="button" className={styles.button} onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {devices.total > PAGE_SIZE ? (
            <div className={styles.pagination}>
              <span>
                Showing {offset + 1}–{to} of {devices.total}
              </span>
              <button
                type="button"
                className={styles.button}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={to >= devices.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

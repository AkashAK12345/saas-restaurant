'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { banquetApi } from '@/lib/banquet/api';
import { formatMinor, toMinor } from '@/lib/banquet/money';
import type { BanquetHall, BanquetPackage } from '@/lib/banquet/types';
import styles from '@/components/banquet/banquet.module.css';

/**
 * Halls and packages.
 *
 * Halls are branch-scoped rooms; packages are the company's commercial
 * catalogue. Package prices are entered as ordinary amounts and converted to
 * whole minor units before they leave the browser — nothing fractional is ever
 * sent.
 */
export default function BanquetCatalogPage() {
  const { selectedCompanyId, selectedBranchId, branchPermissions, companyPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const mayHall = hasPermission(branchPermissions, 'banquet.hall.manage');
  const mayPackage = hasPermission(companyPermissions, 'banquet.package.manage');

  const [halls, setHalls] = useState<BanquetHall[]>([]);
  const [packages, setPackages] = useState<BanquetPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [hallForm, setHallForm] = useState({ name: '', capacity: 100 });
  const [pkgForm, setPkgForm] = useState({ name: '', price: '', currency: 'INR', items: '' });

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      const [h, p] = await Promise.all([banquetApi.listHalls(ctx), banquetApi.listPackages(ctx)]);
      setHalls(h.data);
      setPackages(p.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the catalogue');
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    // Wrapped so no state update happens synchronously inside the effect —
    // the same pattern the queue screens use.
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const priceMinor = toMinor(pkgForm.price, pkgForm.currency);

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading catalogue…
      </p>
    );
  }

  return (
    <>
      <h1>Halls &amp; packages</h1>

      {error ? (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      <div className={styles.columns}>
        <section>
          <h2>Halls</h2>
          {mayHall ? (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await banquetApi.createHall(ctx!, {
                    name: hallForm.name.trim(),
                    capacity: hallForm.capacity,
                  });
                  setHallForm({ name: '', capacity: 100 });
                }, 'Hall created.');
              }}
            >
              <div className={`${styles.grid} ${styles.grid2}`}>
                <div>
                  <label className={styles.label} htmlFor="h-name">
                    Hall name
                  </label>
                  <input
                    id="h-name"
                    className={styles.input}
                    value={hallForm.name}
                    onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={styles.label} htmlFor="h-capacity">
                    Capacity
                  </label>
                  <input
                    id="h-capacity"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10000}
                    className={styles.input}
                    value={hallForm.capacity}
                    onChange={(e) =>
                      setHallForm({
                        ...hallForm,
                        capacity: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                      })
                    }
                  />
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={`${styles.action} ${styles.primary}`}
                  disabled={busy || !hallForm.name.trim()}
                >
                  Add hall
                </button>
              </div>
            </form>
          ) : null}

          {halls.length === 0 ? (
            <p className={styles.empty}>No halls yet.</p>
          ) : (
            <ul className={styles.list}>
              {halls.map((h) => (
                <li key={h.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.title}>{h.name}</span>
                    <span className={styles.badge}>{h.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>
                    <span className={styles.spacer} />
                    <span className={styles.meta}>seats {h.capacity}</span>
                  </div>
                  {mayHall ? (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              banquetApi.updateHall(ctx!, h.id, {
                                status: h.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              }),
                            h.status === 'ACTIVE' ? 'Hall deactivated.' : 'Hall reactivated.',
                          )
                        }
                      >
                        {h.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Packages</h2>
          {mayPackage ? (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (priceMinor === null) return;
                void run(async () => {
                  await banquetApi.createPackage(ctx!, {
                    name: pkgForm.name.trim(),
                    price_per_guest_minor: priceMinor,
                    currency: pkgForm.currency.toUpperCase(),
                    items: pkgForm.items
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .map((name) => ({ name })),
                  });
                  setPkgForm({ name: '', price: '', currency: pkgForm.currency, items: '' });
                }, 'Package created.');
              }}
            >
              <div className={`${styles.grid} ${styles.grid3}`}>
                <div>
                  <label className={styles.label} htmlFor="p-name">
                    Package name
                  </label>
                  <input
                    id="p-name"
                    className={styles.input}
                    value={pkgForm.name}
                    onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={styles.label} htmlFor="p-price">
                    Price per guest
                  </label>
                  <input
                    id="p-price"
                    className={styles.input}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={pkgForm.price}
                    onChange={(e) => setPkgForm({ ...pkgForm, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className={styles.label} htmlFor="p-currency">
                    Currency
                  </label>
                  <input
                    id="p-currency"
                    className={styles.input}
                    maxLength={3}
                    value={pkgForm.currency}
                    onChange={(e) => setPkgForm({ ...pkgForm, currency: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
              <div>
                <label className={styles.label} htmlFor="p-items">
                  Components, one per line
                </label>
                <textarea
                  id="p-items"
                  className={styles.textarea}
                  value={pkgForm.items}
                  onChange={(e) => setPkgForm({ ...pkgForm, items: e.target.value })}
                />
                <p className={styles.hint}>These become the kitchen&rsquo;s list for every booking of this package.</p>
              </div>
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={`${styles.action} ${styles.primary}`}
                  disabled={busy || !pkgForm.name.trim() || priceMinor === null}
                >
                  Add package
                </button>
              </div>
            </form>
          ) : null}

          {packages.length === 0 ? (
            <p className={styles.empty}>No packages yet.</p>
          ) : (
            <ul className={styles.list}>
              {packages.map((p) => (
                <li key={p.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.title}>{p.name}</span>
                    <span className={styles.badge}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</span>
                    <span className={styles.spacer} />
                    <span className={styles.money}>
                      {formatMinor(p.price_per_guest_minor, p.currency)}/guest
                    </span>
                  </div>
                  {p.items.length > 0 ? (
                    <div className={styles.meta}>{p.items.map((i) => i.name).join(' · ')}</div>
                  ) : null}
                  {mayPackage ? (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              banquetApi.updatePackage(ctx!, p.id, {
                                status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              }),
                            p.status === 'ACTIVE' ? 'Package retired.' : 'Package reactivated.',
                          )
                        }
                      >
                        {p.status === 'ACTIVE' ? 'Retire' : 'Reactivate'}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

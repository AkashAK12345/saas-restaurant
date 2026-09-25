'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import {
  inventoryApi,
  type PurchasableItem,
  type PurchaseOptions,
  type RecordedPurchase,
  type SupplierRef,
} from '@/lib/inventory/api';
import { parseQuantity, parseRupees, rupeesInput } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { CreateSupplierSheet } from '@/components/inventory/create-supplier-sheet';
import styles from '@/components/inventory/manual-purchase.module.css';

/** Searching waits this long after the last key before asking the server. */
const SEARCH_DELAY_MS = 250;

interface Line {
  item: PurchasableItem;
  /** As typed, so "1." is not snapped to "1" mid-entry. */
  quantity: string;
  rate: string;
}

/** A line's figures, or null while its quantity or rate is not a valid entry. */
function priced(line: Line) {
  const quantity = parseQuantity(line.quantity);
  const rate = parseRupees(line.rate);
  if (quantity === null || rate === null) return null;
  const net = Math.round(quantity * rate);
  const tax = Math.round((net * line.item.tax_rate_bps) / 10_000);
  return { quantity, rate, net, tax, total: net + tax };
}

/**
 * Manual Purchase — goods that arrived at an outlet from a supplier, entered
 * by hand. Pick the outlet and supplier (or create one), add raw materials by
 * search, set each quantity and rate (prefilled from the item's price, in its
 * purchase unit), and record it: saved as received and unpaid, its stock
 * added at the outlet straight away. GST is added on top of each rate.
 */
export default function ManualPurchasePage() {
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);

  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PurchasableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<RecordedPurchase | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const [opts, list] = await Promise.all([inventoryApi.purchaseOptions(ctx), inventoryApi.suppliers(ctx)]);
        if (cancelled) return;
        setOptions(opts);
        setSuppliers(list);
        // One outlet is no choice at all.
        if (opts.outlets.length === 1) setOutletId(opts.outlets[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the purchase form');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await inventoryApi.searchItems(ctx, q);
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ctx, search]);

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.note}>Choose a company to record a purchase.</p>
      </section>
    );
  }

  const add = (item: PurchasableItem) => {
    setLines((prev) =>
      prev.some((l) => l.item.id === item.id)
        ? prev
        : [...prev, { item, quantity: '1', rate: rupeesInput(item.purchase_price_minor) }],
    );
    setSearch('');
    setResults([]);
    searchRef.current?.focus();
  };
  const update = (id: string, patch: Partial<Pick<Line, 'quantity' | 'rate'>>) =>
    setLines((prev) => prev.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.item.id !== id));

  const figures = lines.map(priced);
  const total = figures.reduce((sum, f) => sum + (f?.total ?? 0), 0);
  const ready = !!outletId && !!supplierId && lines.length > 0 && figures.every(Boolean) && !saving;

  const record = async () => {
    if (!ready || !outletId || !supplierId) return;
    setSaving(true);
    setError(null);
    try {
      const done = await inventoryApi.recordPurchase(ctx, {
        branch_id: outletId,
        vendor_id: supplierId,
        items: lines.map((l, i) => ({ item_id: l.item.id, quantity: figures[i]!.quantity, rate_minor: figures[i]!.rate })),
      });
      setRecorded(done);
      setLines([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the purchase');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/inventory" className={styles.back} aria-label="Back to inventory">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>Manual Purchase</h1>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.pickers}>
          <SearchSelect
            label="Outlet"
            placeholder="Outlet"
            options={(options?.outlets ?? []).map((o) => ({ value: o.id, label: o.name }))}
            value={outletId}
            onChange={setOutletId}
          />
          <SearchSelect
            label="Supplier"
            placeholder="Supplier"
            options={suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.label }))}
            value={supplierId}
            onChange={setSupplierId}
            align="end"
          />
        </div>

        {options?.may_create_supplier ? (
          <button type="button" className={styles.create} onClick={() => setCreating(true)}>
            <AppIcon name="plus" size={20} />
            Create new supplier
          </button>
        ) : null}

        <div className={styles.searchWrap}>
          <label className={styles.search}>
            <AppIcon name="search" size={22} />
            <span className="sr-only">Search raw materials to add</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search raw materials to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-controls="material-results"
            />
          </label>
          {search.trim() ? (
            <ul className={styles.results} id="material-results" aria-label="Matching raw materials">
              {results.map((item) => {
                const added = lines.some((l) => l.item.id === item.id);
                return (
                  <li key={item.id}>
                    <button type="button" className={styles.result} onClick={() => add(item)} disabled={added}>
                      <span className={styles.resultName}>{item.name}</span>
                      <span className={styles.resultMeta}>
                        {item.purchase_price_minor !== null
                          ? `${formatMoney(item.purchase_price_minor, 'INR')} / ${item.purchase_unit}`
                          : `per ${item.purchase_unit}`}
                        {item.tax_rate_bps ? ` · GST ${item.tax_rate_bps / 100}%` : ''}
                        {added ? ' · added' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!searching && results.length === 0 ? <li className={styles.noResult}>No raw material matches that</li> : null}
            </ul>
          ) : null}
        </div>

        {recorded ? (
          <p className={styles.done} role="status">
            <AppIcon name="checkCircle" size={20} />
            Recorded {recorded.po_number}: {formatMoney(recorded.total_minor, recorded.currency)} from {recorded.vendor} at{' '}
            {recorded.branch}.
          </p>
        ) : null}

        <div className={styles.lines}>
          {lines.length === 0 ? (
            <p className={styles.empty}>No items yet — search above to add.</p>
          ) : (
            <ul className={styles.lineList} aria-label="Items on this purchase">
              {lines.map((line, i) => {
                const f = figures[i];
                const converts = line.item.conversion_qty !== null && line.item.purchase_unit !== line.item.unit;
                return (
                  <li key={line.item.id} className={styles.line}>
                    <div className={styles.lineTop}>
                      <span className={styles.lineName}>{line.item.name}</span>
                      <button
                        type="button"
                        className={styles.remove}
                        aria-label={`Remove ${line.item.name}`}
                        onClick={() => remove(line.item.id)}
                      >
                        <AppIcon name="close" size={18} />
                      </button>
                    </div>
                    <div className={styles.lineInputs}>
                      <label className={styles.qty}>
                        <span>Qty ({line.item.purchase_unit})</span>
                        <input
                          inputMode="decimal"
                          value={line.quantity}
                          aria-invalid={parseQuantity(line.quantity) === null}
                          onChange={(e) => update(line.item.id, { quantity: e.target.value })}
                        />
                      </label>
                      <label className={styles.rate}>
                        <span>Rate (₹ / {line.item.purchase_unit})</span>
                        <input
                          inputMode="decimal"
                          value={line.rate}
                          placeholder="0"
                          aria-invalid={parseRupees(line.rate) === null}
                          onChange={(e) => update(line.item.id, { rate: e.target.value })}
                        />
                      </label>
                      <div className={styles.lineTotal}>
                        <span>{line.item.tax_rate_bps ? `+ GST ${line.item.tax_rate_bps / 100}%` : 'No GST'}</span>
                        <strong>{f ? formatMoney(f.total, 'INR') : '—'}</strong>
                      </div>
                    </div>
                    {converts && f ? (
                      <p className={styles.converts}>
                        Adds {Math.round(f.quantity * line.item.conversion_qty! * 1000) / 1000} {line.item.unit} to stock
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <button type="button" className={styles.record} disabled={!ready} onClick={() => void record()}>
          {saving ? 'Recording…' : `Record purchase (${formatMoney(total, 'INR')})`}
        </button>
      </footer>

      {creating ? (
        <CreateSupplierSheet
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(supplier) => {
            setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
            setSupplierId(supplier.id);
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}

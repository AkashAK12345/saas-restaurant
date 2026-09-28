'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import {
  inventoryApi,
  type PurchasableItem,
  type PurchaseOptions,
  type SupplierRef,
} from '@/lib/inventory/api';
import { MAX_ORDER_PHOTOS, PAYMENT_MODES, purchaseOrdersApi, type PaymentMode } from '@/lib/inventory/purchase-orders';
import { parseQuantity, parseRupees, quantity, rupeesInput } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { CreateSupplierSheet } from '@/components/inventory/create-supplier-sheet';
import styles from '@/components/inventory/manual-purchase.module.css';
import photoStyles from '@/components/inventory/order.module.css';

/** Searching waits this long after the last key before asking the server. */
const SEARCH_DELAY_MS = 250;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
/** GST slabs offered on a line, in basis points. */
const GST_SLABS = [0, 500, 1_200, 1_800, 2_800];

interface Line {
  item: PurchasableItem;
  /** As typed, so "1." is not snapped to "1" mid-entry. */
  quantity: string;
  rate: string;
  taxBps: number;
}

/** A delivery photo picked here, sent once the purchase is saved. */
interface Staged {
  key: string;
  file: File;
  url: string;
}

/** A line's figures, or null while its quantity or rate is not a valid entry. */
function priced(line: Line) {
  const q = parseQuantity(line.quantity);
  const rate = parseRupees(line.rate);
  if (q === null || rate === null) return null;
  const net = Math.round(q * rate);
  const tax = Math.round((net * line.taxBps) / 10_000);
  return { quantity: q, rate, net, tax, total: net + tax };
}

export default function ManualPurchasePage() {
  return (
    <Suspense fallback={null}>
      <ManualPurchase />
    </Suspense>
  );
}

/**
 * Manual Purchase — goods bought from a supplier for an outlet. Pick the
 * outlet and supplier (or create one), add raw materials by search, set each
 * quantity, rate and GST, then either:
 *   - record it as received: at least one delivery photo, any payment made,
 *     and the stock lands at once under our own invoice number; or
 *   - save it as an order: it waits in the Purchase tab, to be sent on
 *     WhatsApp and received later.
 * ?as=order opens it on the second (the Purchase tab's "Add purchase").
 */
function ManualPurchase() {
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);
  const asOrderFirst = useSearchParams().get('as') === 'order';

  const [options, setOptions] = useState<PurchaseOptions | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([]);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PurchasableItem[]>([]);
  const [searched, setSearched] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const [asOrder, setAsOrder] = useState(asOrderFirst);
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [photos, setPhotos] = useState<Staged[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; orderId: string } | null>(null);
  /** Saved as an order but not received: where to finish it. */
  const [stranded, setStranded] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([inventoryApi.purchaseOptions(ctx), inventoryApi.suppliers(ctx)])
      .then(([opts, list]) => {
        if (cancelled) return;
        setOptions(opts);
        setSuppliers(list);
        // One outlet is no choice at all.
        if (opts.outlets.length === 1) setOutletId(opts.outlets[0].id);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the purchase form'));
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => {
    const q = search.trim();
    if (!ctx || !q) return;
    let cancelled = false;
    const t = setTimeout(() => {
      inventoryApi
        .searchItems(ctx, q)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setSearched(q);
        })
        .catch(() => undefined);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ctx, search]);

  // Photos picked here live as object URLs until they are sent or dropped.
  const staged = useRef(photos);
  useEffect(() => {
    staged.current = photos;
  }, [photos]);
  useEffect(() => () => staged.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

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
        : [...prev, { item, quantity: '1', rate: rupeesInput(item.purchase_price_minor), taxBps: item.tax_rate_bps }],
    );
    setSearch('');
    setResults([]);
    searchRef.current?.focus();
  };
  const update = (id: string, patch: Partial<Omit<Line, 'item'>>) =>
    setLines((prev) => prev.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));

  const pick = (files: FileList) => {
    const room = MAX_ORDER_PHOTOS - photos.length;
    const added = Array.from(files)
      .slice(0, room)
      .map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...added]);
  };
  const unpick = (key: string) =>
    setPhotos((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.key !== key);
    });

  const figures = lines.map(priced);
  const subtotal = figures.reduce((s, f) => s + (f?.net ?? 0), 0);
  const gst = figures.reduce((s, f) => s + (f?.tax ?? 0), 0);
  const total = subtotal + gst;
  const paidMinor = paid.trim() ? parseRupees(paid) : 0;
  const paidValid = paidMinor !== null && paidMinor <= total;
  const formReady = !!outletId && !!supplierId && lines.length > 0 && figures.every(Boolean) && !saving;
  const ready = formReady && (asOrder || (photos.length > 0 && paidValid));

  const record = async () => {
    if (!ready || !outletId || !supplierId) return;
    setSaving(true);
    setError(null);
    setDone(null);
    setStranded(null);
    try {
      // Saved as an order first: a received purchase is then received the
      // Receive Order way, with its photos, so it gets its invoice number.
      const order = await inventoryApi.recordPurchase(ctx, {
        branch_id: outletId,
        vendor_id: supplierId,
        as_order: true,
        items: lines.map((l, i) => ({
          item_id: l.item.id,
          quantity: figures[i]!.quantity,
          rate_minor: figures[i]!.rate,
          tax_rate_bps: l.taxBps,
        })),
      });
      const money = formatMoney(order.total_minor, order.currency);
      setLines([]);
      if (asOrder) {
        setDone({
          text: `Saved order ${order.po_number}: ${money} to ${order.vendor} for ${order.branch}. Send and receive it from the Purchase tab.`,
          orderId: order.id,
        });
        return;
      }
      try {
        for (const p of photos) {
          await purchaseOrdersApi.uploadPhoto(ctx, order.id, {
            data: await fileToBase64(p.file),
            mime_type: p.file.type || 'image/jpeg',
            file_name: p.file.name,
          });
        }
        const saved = await purchaseOrdersApi.get(ctx, order.id);
        const received = await purchaseOrdersApi.receive(ctx, order.id, {
          lines: saved.lines.map((l) => ({
            id: l.id,
            ...(l.item_id ? { item_id: l.item_id } : {}),
            quantity: l.quantity,
            rate_minor: l.unit_price_minor,
            receive: true,
          })),
          paid_minor: paidMinor ?? 0,
          payment_mode: mode,
        });
        const invoice = received.receipts[received.receipts.length - 1]?.invoice_number;
        setDone({
          text: `Recorded ${order.po_number}: ${money} from ${order.vendor} at ${order.branch}${invoice ? ` · Invoice ${invoice}` : ''}.`,
          orderId: order.id,
        });
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        setPhotos([]);
        setPaid('');
      } catch (e) {
        setError(
          `${order.po_number} is saved as an order but was not received: ${
            e instanceof Error ? e.message : 'something went wrong'
          }. Open it from the Purchase tab to finish receiving.`,
        );
        setStranded(order.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the purchase');
    } finally {
      setSaving(false);
    }
  };

  const q = search.trim();
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
          {q ? (
            <ul className={styles.results} id="material-results" aria-label="Matching raw materials">
              {searched === q
                ? results.map((item) => {
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
                  })
                : null}
              {searched === q && results.length === 0 ? (
                <li className={styles.noResult}>No raw material matches that</li>
              ) : null}
            </ul>
          ) : null}
        </div>

        {done ? (
          <p className={styles.done} role="status">
            <AppIcon name="checkCircle" size={20} />
            <span>
              {done.text} <Link href={`/inventory/purchase/${done.orderId}`}>Open it</Link>
            </span>
          </p>
        ) : null}

        {lines.length === 0 ? (
          <div className={styles.lines}>
            <p className={styles.empty}>No items yet — search above to add.</p>
          </div>
        ) : (
          <ul className={`${styles.cards} ${styles.lineList}`} aria-label="Items on this purchase">
            {lines.map((line, i) => {
              const f = figures[i];
              const unit = line.item.purchase_unit;
              const slabs = GST_SLABS.includes(line.taxBps) ? GST_SLABS : [...GST_SLABS, line.taxBps].sort((a, b) => a - b);
              const into = f ? f.quantity * (line.item.conversion_qty ?? 1) : null;
              return (
                <li key={line.item.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <span className={styles.cardName}>{line.item.name}</span>
                    <span className={styles.cardTotal}>{f ? formatMoney(f.total, 'INR') : '—'}</span>
                    <button
                      type="button"
                      className={styles.cardRemove}
                      aria-label={`Remove ${line.item.name}`}
                      onClick={() => setLines((prev) => prev.filter((l) => l.item.id !== line.item.id))}
                    >
                      <AppIcon name="close" size={22} />
                    </button>
                  </div>
                  <div className={styles.cardFields}>
                    <label className={styles.box} data-invalid={parseQuantity(line.quantity) === null}>
                      <span>Qty</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Qty (${unit})`}
                        value={line.quantity}
                        onChange={(e) => update(line.item.id, { quantity: e.target.value })}
                      />
                      <span>{unit}</span>
                    </label>
                    <label className={styles.box} data-invalid={parseRupees(line.rate) === null}>
                      <span>₹</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Rate (₹ / ${unit})`}
                        placeholder="0"
                        value={line.rate}
                        onChange={(e) => update(line.item.id, { rate: e.target.value })}
                      />
                      <span>/{unit}</span>
                    </label>
                    <label className={styles.box}>
                      <span>GST</span>
                      <select
                        aria-label={`GST on ${line.item.name}`}
                        value={line.taxBps}
                        onChange={(e) => update(line.item.id, { taxBps: Number(e.target.value) })}
                      >
                        {slabs.map((bps) => (
                          <option key={bps} value={bps}>
                            {bps / 100}%
                          </option>
                        ))}
                      </select>
                      <AppIcon name="chevronDown" size={20} />
                    </label>
                  </div>
                  <p className={styles.intoStock}>
                    Into stock: {into === null ? '—' : `${quantity(Math.round(into * 1000) / 1000)} ${line.item.unit}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {lines.length ? (
          <dl className={styles.totals}>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(subtotal, 'INR')}</dd>
            </div>
            <div>
              <dt>GST</dt>
              <dd>{formatMoney(gst, 'INR')}</dd>
            </div>
            <div className={styles.grand}>
              <dt>Total</dt>
              <dd>{formatMoney(total, 'INR')}</dd>
            </div>
          </dl>
        ) : null}

        <div className={styles.modes} role="radiogroup" aria-label="How to save it">
          <label className={styles.mode}>
            <input type="radio" name="purchase-mode" checked={!asOrder} onChange={() => setAsOrder(false)} />
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.modeText}>
              <span className={styles.modeTitle}>Record as received (already bought)</span>
              <span className={styles.modeSub}>Stock updates immediately, payment can be recorded</span>
            </span>
          </label>
          <label className={styles.mode}>
            <input type="radio" name="purchase-mode" checked={asOrder} onChange={() => setAsOrder(true)} />
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.modeText}>
              <span className={styles.modeTitle}>Save as order (send to vendor first)</span>
              <span className={styles.modeSub}>Appears in the Purchase tab — WhatsApp it, receive later</span>
            </span>
          </label>
        </div>

        {asOrder ? null : (
          <>
            <p className={styles.muted}>Invoice number is generated automatically on receive</p>
            <div className={styles.pay}>
              <label className={styles.payField}>
                <span className="sr-only">Paid now</span>
                <input
                  inputMode="decimal"
                  placeholder="Paid now (₹, optional)"
                  value={paid}
                  aria-invalid={!paidValid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </label>
              <label className={styles.payField}>
                Mode
                <select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!paidValid ? <p className={styles.need}>Paid now is more than the total</p> : null}

            <p className={styles.section}>Delivery photos (required)</p>
            <div className={photoStyles.panel}>
              <div className={photoStyles.photoHead}>
                <span className={photoStyles.cameraTile}>
                  <AppIcon name="camera" size={30} />
                </span>
                <span className={photoStyles.photoTitle} data-done={photos.length > 0}>
                  Reference Photos ({photos.length}/{MAX_ORDER_PHOTOS})
                </span>
                {photos.length < MAX_ORDER_PHOTOS ? (
                  <button
                    type="button"
                    className={photoStyles.addPhoto}
                    aria-label="Add a delivery photo"
                    onClick={() => photoInput.current?.click()}
                  >
                    <AppIcon name="imagePlus" size={30} />
                  </button>
                ) : null}
              </div>
              {photos.length ? (
                <div className={photoStyles.photos}>
                  {photos.map((p, i) => (
                    <div key={p.key} className={photoStyles.photo}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
                      <img src={p.url} alt={p.file.name || `Delivery photo ${i + 1}`} />
                      <span className={photoStyles.photoNo}>{i + 1}</span>
                      <button
                        type="button"
                        className={photoStyles.photoRemove}
                        aria-label={`Remove photo ${i + 1}`}
                        onClick={() => unpick(p.key)}
                      >
                        <AppIcon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={photoStyles.photoEmpty}>
                  <AppIcon name="camera" size={56} />
                  <strong>No photos attached</strong>
                  <span>Tap + to add photos (up to {MAX_ORDER_PHOTOS})</span>
                </div>
              )}
              <input
                ref={photoInput}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                aria-label="Delivery photos"
                onChange={(e) => {
                  if (e.target.files) pick(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {photos.length === 0 ? <p className={styles.need}>Add a delivery photo to record the stock</p> : null}
          </>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
            {stranded ? (
              <>
                {' '}
                <Link href={`/inventory/purchase/${stranded}`}>Open the order</Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <button type="button" className={styles.record} disabled={!ready} onClick={() => void record()}>
          {saving
            ? 'Saving…'
            : `${asOrder ? 'Save order' : 'Record purchase'} (${formatMoney(total, 'INR')})`}
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

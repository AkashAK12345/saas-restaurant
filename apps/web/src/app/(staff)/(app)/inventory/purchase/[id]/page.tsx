'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { inventoryApi, type InventoryContext, type PurchasableItem, type SupplierRef } from '@/lib/inventory/api';
import {
  MAX_ORDER_PHOTOS,
  PAYMENT_MODES,
  purchaseOrdersApi,
  type OrderDetail,
  type OrderLine,
  type OrderPhoto,
  type PaymentMode,
} from '@/lib/inventory/purchase-orders';
import { dayTime, parseQuantity, parseRupees, quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { AppIcon } from '@/components/app/icons';
import { printOrder } from '@/components/inventory/order-actions';
import { EditSupplierSheet } from '@/components/inventory/edit-supplier-sheet';
import { SendOrderSheet } from '@/components/inventory/send-order-sheet';
import { PaymentControl } from '@/components/inventory/payment-control';
import styles from '@/components/inventory/order.module.css';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
/** Searching waits this long after the last key before asking the server. */
const SEARCH_DELAY_MS = 250;

/** An awaited line as the screen edits it. */
interface Draft {
  key: string;
  id?: string;
  item_id: string | null;
  name: string;
  unit: string | null;
  taxBps: number;
  /** As typed, so "1." is not snapped to "1" mid-entry. */
  quantity: string;
  rate: string;
  receive: boolean;
}

const rupees = (minor: number) => (minor / 100).toFixed(2);
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

function draftsOf(order: OrderDetail): Draft[] {
  return order.lines
    .filter((l) => !l.received)
    .map((l) => ({
      key: l.id,
      id: l.id,
      item_id: l.item_id,
      name: l.name,
      unit: l.unit,
      taxBps: l.tax_rate_bps,
      quantity: String(l.quantity),
      rate: rupees(l.unit_price_minor),
      receive: true,
    }));
}

/** A line's figures, or null while its quantity or price is not a valid entry. */
function priced(d: Draft) {
  const q = parseQuantity(d.quantity);
  const rate = parseRupees(d.rate);
  if (q === null || rate === null) return null;
  const net = Math.round(q * rate);
  const tax = Math.round((net * d.taxBps) / 10_000);
  return { quantity: q, rate, tax, total: net + tax };
}

/**
 * One purchase order. While it is awaited and the viewer may receive it, it
 * is "Receive Order": change the supplier, adjust or add lines, tick what
 * arrived, add the delivery photos (at least one), note any payment, and
 * receive — the ticked lines become one delivery with its own invoice number
 * and their stock lands at the branch. Otherwise it is "Order", read only,
 * with each delivery under Receipts.
 */
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([]);
  const [photos, setPhotos] = useState<OrderPhoto[]>([]);
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'supplier' | 'send' | null>(null);

  const adopt = useCallback((o: OrderDetail) => {
    setOrder(o);
    setDrafts(draftsOf(o));
    setVendorId(o.vendor.id);
    setPhotos(o.photos);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    purchaseOrdersApi
      .get(ctx, id)
      .then((o) => !cancelled && adopt(o))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the order'));
    return () => {
      cancelled = true;
    };
  }, [ctx, id, adopt]);

  const editing = !!order?.may_edit;
  useEffect(() => {
    if (!ctx || !editing) return;
    let cancelled = false;
    inventoryApi
      .suppliers(ctx)
      .then((s) => !cancelled && setSuppliers(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx, editing]);

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.note}>Choose a company to see its purchases.</p>
      </section>
    );
  }
  if (!order) {
    return (
      <section className={styles.page}>
        <Header title="Order" />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          <p className={styles.note}>Loading…</p>
        )}
      </section>
    );
  }

  const received = order.lines.filter((l) => l.received);
  const figures = drafts.map(priced);
  const ticked = drafts.filter((d) => d.receive);
  const grand = editing
    ? drafts.reduce((sum, d, i) => sum + (d.receive ? (figures[i]?.total ?? 0) : 0), 0)
    : order.total_minor;
  const paidMinor = paid.trim() ? parseRupees(paid) : 0;
  const paidValid = paidMinor !== null && paidMinor <= grand;
  const linesValid = figures.every(Boolean);
  const pendingPhotos = photos.filter((p) => !p.received).length;
  const canSave = editing && !busy && drafts.length > 0 && linesValid;
  const canReceive = canSave && ticked.length > 0 && pendingPhotos > 0 && paidValid;
  const vendor = suppliers.find((s) => s.id === vendorId) ?? order.vendor;

  const payload = (withReceive: boolean) => ({
    ...(vendorId && vendorId !== order.vendor.id ? { vendor_id: vendorId } : {}),
    lines: drafts.map((d, i) => ({
      ...(d.id ? { id: d.id } : {}),
      ...(d.item_id ? { item_id: d.item_id } : {}),
      quantity: figures[i]!.quantity,
      rate_minor: figures[i]!.rate,
      ...(withReceive ? { receive: d.receive } : {}),
    })),
  });

  const run = async (what: 'save' | 'receive') => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (what === 'save') {
        adopt(await purchaseOrdersApi.update(ctx, order.id, payload(false)));
        setMessage('Saved.');
      } else {
        const done = await purchaseOrdersApi.receive(ctx, order.id, {
          ...payload(true),
          paid_minor: paidMinor ?? 0,
          payment_mode: mode,
        });
        adopt(done);
        setPaid('');
        const last = done.receipts[done.receipts.length - 1];
        setMessage(`Received ${items(last.items)} under ${last.invoice_number}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save');
    } finally {
      setBusy(false);
    }
  };

  /** A change made in a sheet: the order anew, keeping what is being typed here. */
  const refreshed = (o: OrderDetail) => {
    setOrder(o);
    setVendorId(o.vendor.id);
    setSheet(null);
  };

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const status =
    order.status === 'RECEIVED'
      ? 'Received'
      : order.status === 'CANCELLED'
        ? 'Cancelled'
        : order.whatsapp_sent_at
          ? 'Awaiting'
          : 'Draft';

  return (
    <section className={styles.page}>
      <Header title={editing ? 'Receive Order' : 'Order'}>
        <button
          type="button"
          className={styles.tool}
          data-tone="blue"
          aria-label="Print"
          onClick={() => printOrder(order.id)}
        >
          <AppIcon name="printer" size={24} />
        </button>
        {order.status !== 'CANCELLED' ? (
          <button
            type="button"
            className={styles.tool}
            data-tone="green"
            aria-label="Send on WhatsApp"
            onClick={() => setSheet('send')}
          >
            <AppIcon name="send" size={24} />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.tool}
          data-tone="terracotta"
          aria-label="Edit supplier"
          disabled={!order.may_edit && !order.may_manage_suppliers}
          onClick={() => setSheet('supplier')}
        >
          <AppIcon name="pencil" size={22} />
        </button>
        <button
          type="button"
          className={styles.tool}
          aria-label="Print a receipt slip"
          onClick={() => printOrder(order.id, 'thermal')}
        >
          <AppIcon name="printer" size={30} />
        </button>
      </Header>

      <div className={styles.vendorBar}>
        <div className={styles.vendor}>
          <span className={styles.vendorIcon}>
            <AppIcon name="store" size={30} />
          </span>
          <span className={styles.vendorText}>
            <span className={styles.vendorName}>{vendor.name}</span>
            <span className={styles.vendorSub}>
              {status} · {items(order.lines.length)}
            </span>
          </span>
          {editing ? <SupplierChange suppliers={suppliers} value={vendorId} onChange={setVendorId} /> : null}
        </div>
      </div>

      <div className={styles.body}>
        {editing || order.receipts.length ? (
          <div className={styles.invoice}>
            <span className={styles.invoiceLabel}>Invoice Number</span>
            {editing ? (
              <span className={styles.invoiceValue}>Auto-generated on receive</span>
            ) : (
              <span className={styles.invoiceNumber}>{order.receipts[order.receipts.length - 1].invoice_number}</span>
            )}
          </div>
        ) : null}

        {order.receipts.length ? (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Receipts</h2>
            {order.receipts.map((r) => (
              <p key={r.id} className={styles.receipt}>
                <AppIcon name="checkRing" size={22} />
                <span>
                  Inv {r.invoice_number} · {items(r.items)} · {dayTime(r.received_at).replace(',', '')}
                  {r.paid_minor ? ` · Paid ${formatMoney(r.paid_minor, order.currency)}` : ''}
                </span>
              </p>
            ))}
          </div>
        ) : null}

        {(editing ? received : order.lines).map((l) => (
          <ReadOnlyLine key={l.id} line={l} currency={order.currency} tagged={editing} />
        ))}

        {editing
          ? drafts.map((d, i) => {
              const f = figures[i];
              return (
                <div key={d.key} className={styles.panel}>
                  <div className={styles.lineTop}>
                    <label className={styles.tick}>
                      <input
                        type="checkbox"
                        checked={d.receive}
                        aria-label={`Receive ${d.name}`}
                        onChange={(e) => update(d.key, { receive: e.target.checked })}
                      />
                      <span className={styles.box} aria-hidden="true">
                        {d.receive ? <AppIcon name="check" size={18} /> : null}
                      </span>
                    </label>
                    <span className={styles.lineName}>{d.name}</span>
                    <button
                      type="button"
                      className={styles.removeLine}
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                    >
                      <AppIcon name="close" size={22} />
                    </button>
                  </div>
                  <div className={styles.fields}>
                    <label className={styles.field} data-invalid={parseQuantity(d.quantity) === null}>
                      <span className={styles.fieldLabel}>Qty</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Quantity of ${d.name}`}
                        value={d.quantity}
                        onChange={(e) => update(d.key, { quantity: e.target.value })}
                      />
                      {d.unit ? <span>{d.unit}</span> : null}
                    </label>
                    <label className={styles.field} data-invalid={parseRupees(d.rate) === null}>
                      <span className={styles.fieldLabel}>Price (₹)</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Price of ${d.name}`}
                        value={d.rate}
                        placeholder="0.00"
                        onChange={(e) => update(d.key, { rate: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className={styles.lineFoot}>
                    {d.taxBps && f ? (
                      <span>
                        GST {d.taxBps / 100}% · {formatMoney(f.tax, order.currency)}
                      </span>
                    ) : null}
                    <span className={styles.lineTotal}>{f ? formatMoney(f.total, order.currency) : '—'}</span>
                  </div>
                </div>
              );
            })
          : null}

        {editing ? (
          <AddItem
            ctx={ctx}
            onAdd={(item) =>
              setDrafts((prev) =>
                prev.some((d) => d.item_id === item.id)
                  ? prev
                  : [
                      ...prev,
                      {
                        key: `new-${item.id}`,
                        item_id: item.id,
                        name: item.name,
                        unit: item.purchase_unit,
                        taxBps: item.tax_rate_bps,
                        quantity: '1',
                        rate: item.purchase_price_minor === null ? '' : rupees(item.purchase_price_minor),
                        receive: true,
                      },
                    ],
              )
            }
            taken={new Set(drafts.flatMap((d) => (d.item_id ? [d.item_id] : [])))}
          />
        ) : null}

        {order.status === 'RECEIVED' ? (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Payment</h2>
            <PaymentControl
              ctx={ctx}
              orderId={order.id}
              supplier={order.vendor.name}
              total={order.total_minor}
              paid={order.paid_minor}
              mode={order.payment_mode}
              currency={order.currency}
              editable={order.may_record_payment}
              onChanged={adopt}
            />
          </div>
        ) : null}

        <p className={styles.sectionLabel}>Delivery photos{editing ? ' (required)' : ''}</p>
        <Photos
          ctx={ctx}
          orderId={order.id}
          photos={photos}
          editable={editing}
          onChange={setPhotos}
          onError={setError}
        />

        {message ? (
          <p className={styles.done} role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {sheet === 'supplier' ? (
        <EditSupplierSheet ctx={ctx} order={order} onClose={() => setSheet(null)} onSaved={refreshed} />
      ) : null}
      {sheet === 'send' ? (
        <SendOrderSheet ctx={ctx} orderId={order.id} known={order} onClose={() => setSheet(null)} onSent={refreshed} />
      ) : null}

      <footer className={styles.foot}>
        <div className={styles.footInner}>
          {editing ? (
            <div className={styles.pay}>
              <label className={styles.payField}>
                Paid Amount
                <input
                  inputMode="decimal"
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
              <span className={styles.payState}>
                <span>{!paidMinor ? 'Unpaid' : paidMinor >= grand ? 'Paid' : 'Part paid'}</span>
                {paidValid ? (
                  <span className={styles.outstanding}>
                    Outstanding {formatMoney(Math.max(grand - (paidMinor ?? 0), 0), order.currency)}
                  </span>
                ) : (
                  <span className={styles.outstanding}>More than this delivery comes to</span>
                )}
              </span>
            </div>
          ) : null}
          <div className={styles.totals}>
            <span className={styles.grand}>
              Grand Total
              <strong>{formatMoney(grand, order.currency)}</strong>
            </span>
            {editing ? (
              <>
                <button type="button" className={styles.save} disabled={!canSave} onClick={() => void run('save')}>
                  Save
                </button>
                <button
                  type="button"
                  className={styles.receive}
                  disabled={!canReceive}
                  onClick={() => void run('receive')}
                >
                  {busy ? 'Saving…' : `Receive (${ticked.length})`}
                </button>
              </>
            ) : null}
          </div>
          {editing && pendingPhotos === 0 ? <p className={styles.hint}>Add at least one delivery photo to receive</p> : null}
        </div>
      </footer>
    </section>
  );
}

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={styles.head}>
      <div className={styles.headLeft}>
        <Link href="/inventory/purchase" className={styles.back} aria-label="Back to purchases">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>
      {children ? <div className={styles.tools}>{children}</div> : null}
    </header>
  );
}

function ReadOnlyLine({ line: l, currency, tagged }: { line: OrderLine; currency: string; tagged: boolean }) {
  return (
    <div className={styles.panel}>
      <div className={styles.lineTop}>
        <span className={styles.lineName}>{l.name}</span>
        {tagged ? <span className={styles.receivedTag}>Received</span> : null}
      </div>
      <div className={styles.fields}>
        <span className={styles.field}>
          <span className={styles.fieldLabel}>Qty</span>
          <span className={styles.fieldValue}>
            {quantity(l.quantity)}
            {l.unit ? ` ${l.unit}` : ''}
          </span>
        </span>
        <span className={styles.field}>
          <span className={styles.fieldLabel}>Price (₹)</span>
          <span className={styles.fieldValue}>{rupees(l.unit_price_minor)}</span>
        </span>
      </div>
      <div className={styles.lineFoot}>
        {l.tax_rate_bps ? (
          <span>
            GST {l.tax_rate_bps / 100}% · {formatMoney(l.tax_minor, currency)}
          </span>
        ) : null}
        <span className={styles.lineTotal}>{formatMoney(l.line_total_minor, currency)}</span>
      </div>
    </div>
  );
}

/** "Change ▾": pick another supplier from a searchable list. */
function SupplierChange({
  suppliers,
  value,
  onChange,
}: {
  suppliers: SupplierRef[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? suppliers.filter((s) => s.name.toLowerCase().includes(needle) || (s.label ?? '').toLowerCase().includes(needle))
    : suppliers;

  return (
    <div className={styles.changeWrap} ref={wrap}>
      <button
        type="button"
        className={styles.change}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Change
        <AppIcon name="chevronDown" size={18} />
      </button>
      {open ? (
        <div className={styles.picker} role="dialog" aria-label="Change supplier">
          <input
            className={styles.pickerSearch}
            type="search"
            placeholder="Search suppliers"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className={styles.pickerList} role="listbox" aria-label="Suppliers">
            {shown.map((s) => (
              <li key={s.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={s.id === value}
                  className={styles.pickerItem}
                  onClick={() => {
                    onChange(s.id);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {s.name}
                  {s.label ? <span className={styles.pickerHint}>{s.label}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** "+ Add item": search the raw materials and add one to the order. */
function AddItem({
  ctx,
  onAdd,
  taken,
}: {
  ctx: InventoryContext;
  onAdd: (item: PurchasableItem) => void;
  taken: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PurchasableItem[]>([]);
  const [searched, setSearched] = useState('');

  useEffect(() => {
    const needle = q.trim();
    if (!needle) return;
    let cancelled = false;
    const t = setTimeout(() => {
      inventoryApi
        .searchItems(ctx, needle)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setSearched(needle);
        })
        .catch(() => undefined);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ctx, q]);

  if (!open) {
    return (
      <div className={styles.addWrap}>
        <button type="button" className={styles.addItem} onClick={() => setOpen(true)}>
          <AppIcon name="plus" size={22} />
          Add item
        </button>
      </div>
    );
  }

  const needle = q.trim();
  return (
    <div className={styles.addWrap}>
      <label className={styles.addSearch}>
        <AppIcon name="search" size={20} />
        <span className="sr-only">Search raw materials to add</span>
        <input
          type="search"
          placeholder="Search raw materials to add…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        />
      </label>
      {needle ? (
        <ul className={styles.results} aria-label="Matching raw materials">
          {searched === needle
            ? results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.result}
                    disabled={taken.has(item.id)}
                    onClick={() => {
                      onAdd(item);
                      setQ('');
                      setOpen(false);
                    }}
                  >
                    {item.name}
                    <span className={styles.resultMeta}>
                      {item.purchase_price_minor !== null
                        ? `${formatMoney(item.purchase_price_minor, 'INR')} / ${item.purchase_unit}`
                        : `per ${item.purchase_unit}`}
                      {taken.has(item.id) ? ' · on the order' : ''}
                    </span>
                  </button>
                </li>
              ))
            : null}
          {searched === needle && results.length === 0 ? (
            <li className={styles.noResult}>No raw material matches that</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** The delivery photos: upload on pick, remove until received. */
function Photos({
  ctx,
  orderId,
  photos,
  editable,
  onChange,
  onError,
}: {
  ctx: InventoryContext;
  orderId: string;
  photos: OrderPhoto[];
  editable: boolean;
  onChange: (next: OrderPhoto[]) => void;
  onError: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const room = MAX_ORDER_PHOTOS - photos.length;

  const upload = async (files: FileList) => {
    const picked = Array.from(files).slice(0, room);
    if (!picked.length) return;
    setBusy(true);
    onError(null);
    let next = photos;
    try {
      for (const file of picked) {
        const photo = await purchaseOrdersApi.uploadPhoto(ctx, orderId, {
          data: await fileToBase64(file),
          mime_type: file.type || 'image/jpeg',
          file_name: file.name,
        });
        next = [...next, photo];
        onChange(next);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photoId: string) => {
    setBusy(true);
    onError(null);
    try {
      await purchaseOrdersApi.deletePhoto(ctx, orderId, photoId);
      onChange(photos.filter((p) => p.id !== photoId));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.photoHead}>
        <span className={styles.cameraTile}>
          <AppIcon name="camera" size={30} />
        </span>
        <span className={styles.photoTitle} data-done={photos.length > 0}>
          Reference Photos ({photos.length}/{MAX_ORDER_PHOTOS})
        </span>
        {editable && room > 0 ? (
          <button
            type="button"
            className={styles.addPhoto}
            aria-label="Add a delivery photo"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <AppIcon name="imagePlus" size={30} />
          </button>
        ) : null}
      </div>
      {photos.length ? (
        <div className={styles.photos}>
          {photos.map((p, i) => (
            <Thumb
              key={p.id}
              ctx={ctx}
              orderId={orderId}
              photo={p}
              n={i + 1}
              onRemove={editable && !p.received ? () => void remove(p.id) : undefined}
              disabled={busy}
            />
          ))}
        </div>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        aria-label="Delivery photos"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Thumb({
  ctx,
  orderId,
  photo,
  n,
  onRemove,
  disabled,
}: {
  ctx: InventoryContext;
  orderId: string;
  photo: OrderPhoto;
  n: number;
  onRemove?: () => void;
  disabled: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    purchaseOrdersApi
      .photo(ctx, orderId, photo.id)
      .then(({ blob }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => undefined); // A thumbnail is a convenience, not the record.
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ctx, orderId, photo.id]);

  return (
    <div className={styles.photo}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an optimisable asset */}
      {src ? <img src={src} alt={photo.file_name ?? `Delivery photo ${n}`} /> : null}
      <span className={styles.photoNo}>{n}</span>
      {onRemove ? (
        <button type="button" className={styles.photoRemove} aria-label={`Remove photo ${n}`} disabled={disabled} onClick={onRemove}>
          <AppIcon name="close" size={16} />
        </button>
      ) : null}
    </div>
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

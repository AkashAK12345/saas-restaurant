'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { inventoryApi, type InventoryFilters, type SupplierRef } from '@/lib/inventory/api';
import {
  purchaseOrdersApi,
  type OrderCard,
  type OrderList,
  type OrderSort,
  type OrderTab,
} from '@/lib/inventory/purchase-orders';
import { dayMonth, dayTime, quantity } from '@/lib/inventory/format';
import { formatMoney, branchToday } from '@/lib/reports/format';
import { pillRangeLabel } from '@/lib/reports/purchase-ui';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { printOrder } from '@/components/inventory/order-actions';
import { SendOrderSheet } from '@/components/inventory/send-order-sheet';
import { PaymentControl } from '@/components/inventory/payment-control';
import styles from '@/components/inventory/purchase.module.css';

/** Orders asked for at a time; "Show more" asks for the next page. */
const PAGE = 30;

/** A control drawn as the reference has it, whose screen is still to come. */
const soon = { 'aria-disabled': true, title: 'Coming soon' } as const;

type Tab = OrderTab;

/** Draft: saved, not sent. Sent: went on WhatsApp, awaiting delivery. Received: in. */
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
];

const SORTS: ReadonlyArray<{ key: OrderSort; label: string; icon: AppIconName }> = [
  { key: 'newest', label: 'Newest first', icon: 'sort' },
  { key: 'oldest', label: 'Oldest first', icon: 'arrowUp' },
  { key: 'received', label: 'Recently received', icon: 'truck' },
  { key: 'supplier', label: 'Supplier (A–Z)', icon: 'sortAz' },
  { key: 'amount', label: 'Highest amount', icon: 'cash' },
];

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/**
 * Purchase — every purchase order at the branches the viewer may see: All,
 * Draft (saved, not yet sent to the supplier), Sent (went on WhatsApp,
 * awaiting delivery) and Received (with its payment, marked paid or unpaid
 * there). Each card sends, prints, cancels or opens its order, where it is
 * received.
 */
export default function PurchaseOrdersPage() {
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);

  const [filters, setFilters] = useState<InventoryFilters | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [dialog, setDialog] = useState(false);
  // Drawn pressed, as the reference shows it: cancelled orders are listed.
  const [withCancelled, setWithCancelled] = useState(true);
  const [sort, setSort] = useState<OrderSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);

  const [data, setData] = useState<OrderList | null>(null);
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** Bumped to read the list again after a change. */
  const [reads, setReads] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([inventoryApi.filters(ctx), inventoryApi.suppliers(ctx)])
      .then(([f, s]) => {
        if (cancelled) return;
        setFilters(f);
        setSuppliers(s);
      })
      .catch(() => undefined); // The list reports any refusal.
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: PointerEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSortOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [sortOpen]);

  const query = useMemo(
    () => ({
      tab,
      branch_id: branchId ?? undefined,
      vendor_id: vendorId ?? undefined,
      from: range?.from,
      to: range?.to,
      include_cancelled: tab !== 'received' && withCancelled,
      sort,
    }),
    [tab, branchId, vendorId, range, withCancelled, sort],
  );

  // The first page follows the filters; "Show more" appends the next.
  const key = `${JSON.stringify(query)}#${reads}`;
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    purchaseOrdersApi
      .list(ctx, { ...query, limit: PAGE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setOrders(res.orders);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load purchase orders');
        setOrders([]);
        setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, query, key]);
  const loading = loadedKey !== key || more;

  const showMore = async () => {
    if (!ctx) return;
    setMore(true);
    try {
      const res = await purchaseOrdersApi.list(ctx, { ...query, limit: PAGE, offset: orders.length });
      setData(res);
      setOrders((prev) => [...prev, ...res.orders]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load purchase orders');
    } finally {
      setMore(false);
    }
  };

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.empty}>Choose a company to see its purchases.</p>
      </section>
    );
  }

  const act = async (order: OrderCard, what: 'send' | 'cancel') => {
    if (what === 'send') return setSending(order.id);
    if (!window.confirm(`Cancel the order to ${order.vendor.name}?`)) return;
    setBusy(order.id);
    setError(null);
    try {
      await purchaseOrdersApi.cancel(ctx, order.id);
      setReads((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  const counts = data?.counts;
  const sortLabel = SORTS.find((s) => s.key === sort)!.label;
  const supplierPick = (
    <SearchSelect
      label="Supplier"
      allLabel="All suppliers"
      options={suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.label }))}
      value={vendorId}
      onChange={setVendorId}
    />
  );
  const datesPick = (
    <div className={styles.datesWrap}>
      <button type="button" className={styles.dates} onClick={() => setDialog(true)} aria-label="Dates">
        <AppIcon name="calendar" size={22} />
        <span>{range ? pillRangeLabel(range.from, range.to) : 'Select dates'}</span>
      </button>
      {range ? (
        <button type="button" className={styles.clearDates} aria-label="Clear dates" onClick={() => setRange(null)}>
          <AppIcon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );

  return (
    <section className={styles.page}>
      <div className={styles.top}>
        <div className={styles.topInner}>
          <header className={styles.head}>
            <Link href="/inventory" className={styles.back} aria-label="Back to inventory">
              <AppIcon name="back" size={22} />
            </Link>
            <div>
              <p className={styles.eyebrow}>Inventory</p>
              <h1 className={styles.title}>Purchase</h1>
            </div>
          </header>

          <div className={styles.headTools}>
            <div className={styles.branchPick}>
              <SearchSelect
                label="Branch"
                allLabel="All Branches"
                options={(filters?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
                value={branchId}
                onChange={setBranchId}
                align="end"
              />
            </div>
            <button type="button" className={styles.iconBtn} aria-label="Order summary" {...soon}>
              <AppIcon name="checklist" size={24} />
            </button>
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Purchase orders">
            {TABS.map((t) => {
              const n = t.key === 'received' ? undefined : counts?.[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={styles.tab}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {n !== undefined ? <span className={styles.count}>{n}</span> : null}
                </button>
              );
            })}
          </div>

          {            <>
              <div className={styles.filters} data-cols={tab === 'received' ? '2' : undefined}>
                {supplierPick}
                {datesPick}
                {tab !== 'received' ? (
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-pressed={withCancelled}
                    onClick={() => setWithCancelled((v) => !v)}
                  >
                    {withCancelled ? <AppIcon name="check" size={20} /> : null}
                    Cancelled ({counts?.cancelled ?? 0})
                  </button>
                ) : null}
              </div>
              <div className={styles.sortWrap} ref={sortRef}>
                <button
                  type="button"
                  className={styles.sortBtn}
                  aria-haspopup="menu"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((v) => !v)}
                >
                  <AppIcon name="sort" size={20} />
                  {sortLabel}
                </button>
                {sortOpen ? (
                  <ul className={styles.menu} role="menu" aria-label="Sort by">
                    {SORTS.map((s) => (
                      <li key={s.key} role="none">
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={sort === s.key}
                          className={styles.menuItem}
                          onClick={() => {
                            setSort(s.key);
                            setSortOpen(false);
                          }}
                        >
                          <AppIcon name={sort === s.key ? 'check' : s.icon} size={22} />
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          }
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {orders.length === 0 ? (
        <p className={styles.empty}>{loading ? 'Loading…' : 'No purchase orders here.'}</p>
      ) : (
        <ul className={styles.list} aria-label="Purchase orders">
          {orders.map((o) => (
            <OrderCardView
              key={o.id}
              ctx={ctx}
              order={o}
              busy={busy === o.id}
              onAct={(what) => void act(o, what)}
              onChanged={() => setReads((n) => n + 1)}
            />
          ))}
          {data && orders.length < data.meta.total ? (
            <li className={styles.moreRow}>
              <button type="button" className={styles.more} disabled={loading} onClick={() => void showMore()}>
                {loading ? 'Loading…' : 'Show more'}
              </button>
            </li>
          ) : null}
        </ul>
      )}

      <Link href="/inventory/manual-purchase?as=order" className={styles.fab}>
        <AppIcon name="cartPlus" size={24} />
        Add purchase
      </Link>

      {sending ? (
        <SendOrderSheet
          ctx={ctx}
          orderId={sending}
          onClose={() => setSending(null)}
          onSent={() => {
            setSending(null);
            setReads((n) => n + 1);
          }}
        />
      ) : null}

      {dialog ? (
        <DateDialog
          mode="range"
          initial={range ?? { from: branchToday('Asia/Kolkata'), to: branchToday('Asia/Kolkata') }}
          max={branchToday('Asia/Kolkata')}
          onCancel={() => setDialog(false)}
          onApply={(picked) => {
            setRange(picked);
            setDialog(false);
          }}
        />
      ) : null}
    </section>
  );
}

function OrderCardView({
  ctx,
  order: o,
  busy,
  onAct,
  onChanged,
}: {
  ctx: { companyId: string };
  order: OrderCard;
  busy: boolean;
  onAct: (what: 'send' | 'cancel') => void;
  onChanged: () => void;
}) {
  const href = `/inventory/purchase/${o.id}`;
  const received = o.status === 'RECEIVED';
  const cancelled = o.status === 'CANCELLED';

  const meta = received
    ? [
        items(o.items_count),
        o.received_at ? `Received ${dayTime(o.received_at)}` : null,
        o.invoice_number ? `Inv ${o.invoice_number}` : null,
        o.branch.name,
      ]
    : [
        o.received_count ? `${o.received_count} of ${items(o.items_count)} received` : items(o.items_count),
        o.created_by ? `Created by ${o.created_by}` : null,
        dayMonth(o.ordered_at),
        o.branch.name,
      ];

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <Link href={href} className={styles.supplier}>
          {o.vendor.name}
        </Link>
        <span className={styles.cardRight}>
          {received ? (
            <span className={styles.badge} data-tone="green">
              <AppIcon name="checkRing" size={18} />
              Received
            </span>
          ) : cancelled ? (
            <span className={styles.badge} data-tone="red">
              <AppIcon name="xCircle" size={18} />
              Cancelled
            </span>
          ) : o.whatsapp_sent_at ? (
            <span className={styles.badge} data-tone="amber">
              <AppIcon name="clock" size={18} />
              Awaiting
            </span>
          ) : (
            // Saved, not yet sent to the supplier.
            <span className={styles.badge} data-tone="blue">
              <AppIcon name="pencil" size={16} />
              Draft
            </span>
          )}
          {received ? <span className={styles.amount}>{formatMoney(o.total_minor, o.currency)}</span> : null}
        </span>
      </div>
      <p className={styles.meta}>{meta.filter(Boolean).join(' · ')}</p>
      {received ? (
        <PaymentControl
          ctx={ctx}
          orderId={o.id}
          supplier={o.vendor.name}
          total={o.total_minor}
          paid={o.paid_minor}
          mode={o.payment_mode}
          currency={o.currency}
          editable={o.may_edit}
          onChanged={onChanged}
        />
      ) : null}

      <div className={styles.actions}>
        {!received && !cancelled && o.may_edit && o.received_count === 0 ? (
          <button
            type="button"
            className={styles.act}
            data-tone="red"
            aria-label={`Cancel the order to ${o.vendor.name}`}
            disabled={busy}
            onClick={() => onAct('cancel')}
          >
            <AppIcon name="xCircle" size={28} />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.act}
          data-tone="blue"
          aria-label={`Print the order to ${o.vendor.name}`}
          onClick={() => printOrder(o.id)}
        >
          <AppIcon name="printer" size={24} />
        </button>
        {!cancelled ? (
          <button
            type="button"
            className={styles.act}
            data-tone="green"
            aria-label={`Send the order to ${o.vendor.name} on WhatsApp`}
            disabled={busy}
            onClick={() => onAct('send')}
          >
            <AppIcon name="send" size={24} />
          </button>
        ) : null}
        {!cancelled ? (
          <Link href={href} className={styles.act} data-tone="terracotta" aria-label={`Open the order to ${o.vendor.name}`}>
            <AppIcon name="pencil" size={22} />
          </Link>
        ) : null}
      </div>

      {!received && o.chips.length ? (
        <div className={styles.chips}>
          {o.chips.map((c, i) => (
            <span key={i} className={styles.chip}>
              {c.name} {quantity(c.quantity)}
              {c.unit ? ` ${c.unit}` : ''}
            </span>
          ))}
          {o.more_items ? <span className={styles.chip}>+{o.more_items} more</span> : null}
        </div>
      ) : null}
    </li>
  );
}

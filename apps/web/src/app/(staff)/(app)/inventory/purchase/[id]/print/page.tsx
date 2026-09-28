'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { purchaseOrdersApi, PAYMENT_MODES, type OrderDetail } from '@/lib/inventory/purchase-orders';
import { dayTime, quantity } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import styles from '@/components/inventory/order-print.module.css';

/**
 * An order to print: A4 (to hand the supplier or file), or a thermal slip
 * (?format=thermal). It prints itself once the order has loaded.
 */
export default function PrintOrderPage() {
  return (
    <Suspense fallback={null}>
      <PrintOrder />
    </Suspense>
  );
}

function PrintOrder() {
  const { id } = useParams<{ id: string }>();
  const thermal = useSearchParams().get('format') === 'thermal';
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    purchaseOrdersApi
      .get(ctx, id)
      .then((o) => !cancelled && setOrder(o))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the order'));
    return () => {
      cancelled = true;
    };
  }, [ctx, id]);

  useEffect(() => {
    if (!order) return;
    // Let the page paint before the print dialog takes over.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [order]);

  if (error) return <p className={styles.note}>{error}</p>;
  if (!order) return <p className={styles.note}>Preparing…</p>;

  const money = (minor: number) => formatMoney(minor, order.currency);
  const tax = order.lines.reduce((s, l) => s + l.tax_minor, 0);
  const due = order.total_minor - order.paid_minor;
  const status = order.status === 'RECEIVED' ? 'Received' : order.status === 'CANCELLED' ? 'Cancelled' : 'Awaiting delivery';
  const mode = (m: string | null) => PAYMENT_MODES.find((p) => p.value === m)?.label ?? '';

  return (
    <article className={styles.doc} data-format={thermal ? 'thermal' : 'a4'}>
      <header className={styles.top}>
        <h1 className={styles.title}>Purchase Order</h1>
        <p className={styles.number}>{order.po_number}</p>
        <p className={styles.muted}>
          {dayTime(order.ordered_at)} · {status}
        </p>
      </header>

      <div className={styles.parties}>
        <div>
          <p className={styles.label}>Supplier</p>
          <p className={styles.strong}>{order.vendor.name}</p>
          {order.vendor.phone ? <p>{order.vendor.phone}</p> : null}
        </div>
        <div>
          <p className={styles.label}>Deliver to</p>
          <p className={styles.strong}>{order.branch.name}</p>
          {order.created_by ? <p>Raised by {order.created_by}</p> : null}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th className={styles.num}>Qty</th>
            {thermal ? null : <th className={styles.num}>Rate</th>}
            {thermal ? null : <th className={styles.num}>GST</th>}
            <th className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={l.id}>
              <td>{i + 1}</td>
              <td>
                {l.name}
                {l.received ? <span className={styles.tag}> ✓</span> : null}
              </td>
              <td className={styles.num}>
                {quantity(l.quantity)}
                {l.unit ? ` ${l.unit}` : ''}
              </td>
              {thermal ? null : <td className={styles.num}>{money(l.unit_price_minor)}</td>}
              {thermal ? null : <td className={styles.num}>{l.tax_rate_bps ? `${l.tax_rate_bps / 100}%` : '—'}</td>}
              <td className={styles.num}>{money(l.line_total_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className={styles.totals}>
        <div>
          <dt>GST</dt>
          <dd>{money(tax)}</dd>
        </div>
        <div className={styles.grand}>
          <dt>Grand Total</dt>
          <dd>{money(order.total_minor)}</dd>
        </div>
        {order.paid_minor ? (
          <div>
            <dt>Paid</dt>
            <dd>{money(order.paid_minor)}</dd>
          </div>
        ) : null}
        {order.status !== 'CANCELLED' ? (
          <div>
            <dt>Due</dt>
            <dd>{money(due)}</dd>
          </div>
        ) : null}
      </dl>

      {order.receipts.length ? (
        <section className={styles.receipts}>
          <p className={styles.label}>Receipts</p>
          {order.receipts.map((r) => (
            <p key={r.id}>
              Inv {r.invoice_number} · {r.items} {r.items === 1 ? 'item' : 'items'} · {dayTime(r.received_at)}
              {r.paid_minor ? ` · Paid ${money(r.paid_minor)} ${mode(r.payment_mode)}` : ''}
            </p>
          ))}
        </section>
      ) : null}
    </article>
  );
}

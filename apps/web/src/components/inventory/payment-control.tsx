'use client';

import { useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { PAYMENT_MODES, purchaseOrdersApi, type OrderDetail, type PaymentMode } from '@/lib/inventory/purchase-orders';
import { formatMoney } from '@/lib/reports/format';
import styles from './payment.module.css';

/**
 * A received purchase's payment: what is due or how it was paid, and — for
 * someone who may — an Unpaid / Paid switch. Paid asks how it was paid;
 * Unpaid asks first, since it puts the whole amount back as due.
 */
export function PaymentControl({
  ctx,
  orderId,
  supplier,
  total,
  paid,
  mode,
  currency,
  editable,
  onChanged,
}: {
  ctx: InventoryContext;
  orderId: string;
  supplier: string;
  total: number;
  paid: number;
  mode: PaymentMode | null;
  currency: string;
  editable: boolean;
  onChanged: (order: OrderDetail) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [choice, setChoice] = useState<PaymentMode>(mode ?? 'CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = paid >= total;
  const due = Math.max(total - paid, 0);
  const how = PAYMENT_MODES.find((m) => m.value === mode)?.label;

  const save = async (body: { paid: true; payment_mode: PaymentMode } | { paid: false }) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await purchaseOrdersApi.markPaid(ctx, orderId, body));
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the payment');
    } finally {
      setBusy(false);
    }
  };

  const unpay = () => {
    if (paid === 0) return;
    if (!window.confirm(`Mark the purchase from ${supplier} unpaid? ${formatMoney(total, currency)} will be due again.`)) return;
    void save({ paid: false });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {full ? (
          <p className={styles.state} data-tone="paid">
            Paid{how ? ` · ${how}` : ''}
          </p>
        ) : (
          <p className={styles.state} data-tone="due">
            {paid > 0 ? 'Part paid · ' : ''}Due {formatMoney(due, currency)}
          </p>
        )}
        {editable ? (
          <div className={styles.toggle} role="group" aria-label={`Payment for ${supplier}`}>
            <button type="button" data-kind="unpaid" aria-pressed={!full} disabled={busy} onClick={unpay}>
              Unpaid
            </button>
            <button
              type="button"
              data-kind="paid"
              aria-pressed={full}
              disabled={busy || full}
              onClick={() => setAsking(true)}
            >
              Paid
            </button>
          </div>
        ) : null}
      </div>
      {asking ? (
        <div className={styles.confirm}>
          <label>
            Paid by
            <select value={choice} onChange={(e) => setChoice(e.target.value as PaymentMode)} aria-label="Paid by">
              {PAYMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.cancel} disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.save}
            disabled={busy}
            onClick={() => void save({ paid: true, payment_mode: choice })}
          >
            {busy ? 'Saving…' : `Mark paid ${formatMoney(total, currency)}`}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

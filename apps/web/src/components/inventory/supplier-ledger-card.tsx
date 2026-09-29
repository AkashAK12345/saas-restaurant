'use client';

import { useEffect, useState } from 'react';
import type { InventoryContext } from '@/lib/inventory/api';
import { PAYMENT_MODES, type PaymentMode } from '@/lib/inventory/purchase-orders';
import {
  supplierLedgerApi,
  type LedgerQuery,
  type LedgerSupplier,
  type SupplierInvoice,
  type SupplierLedgerDetail,
} from '@/lib/inventory/supplier-ledger';
import { shortDay } from '@/lib/inventory/reports';
import { parseRupees } from '@/lib/inventory/format';
import { formatMoney } from '@/lib/reports/format';
import { saveFile } from '@/lib/reports/api';
import { AppIcon } from '@/components/app/icons';
import { SupplierSendSheet } from './supplier-send-sheet';
import styles from './supplier-ledger.module.css';

const money = (m: number) => formatMoney(m, 'INR');

/** The WhatsApp summary a supplier receives with their statement. */
export function statementMessage(s: LedgerSupplier, detail: SupplierLedgerDetail | null, period: string): string {
  const due = (detail?.invoices ?? []).filter((i) => i.due_minor > 0);
  return [
    `*Statement: ${period}*`,
    `To: ${s.name}`,
    '',
    `Opening: ${money(s.opening_minor)}`,
    `Purchases: ${money(s.purchases_minor)}`,
    `Paid: ${money(s.paid_minor)}`,
    `*Closing (due): ${money(s.closing_minor)}*`,
    ...(due.length
      ? ['', 'Due invoices:', ...due.map((i) => `• ${shortDay(i.date)} · ${i.invoice_number} — ${money(i.due_minor)}`)]
      : []),
  ].join('\n');
}

/**
 * One supplier on the ledger: opening, purchases, paid and closing for the
 * cycle, and — opened — where to pay them, their statement, and each
 * invoice with what is due on it, to pay one by one or all at once.
 */
export function SupplierLedgerCard({
  ctx,
  supplier: s,
  query,
  period,
  onChanged,
}: {
  ctx: InventoryContext;
  supplier: LedgerSupplier;
  query: LedgerQuery;
  period: string;
  onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SupplierLedgerDetail | null>(null);
  const [reads, setReads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<SupplierInvoice | 'all' | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    supplierLedgerApi
      .supplier(ctx, s.vendor_id, JSON.parse(queryKey) as LedgerQuery)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the supplier'));
    return () => {
      cancelled = true;
    };
  }, [ctx, s.vendor_id, queryKey, open, reads]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // No clipboard: the value is on screen to copy by hand.
    }
  };

  const download = async (fetch: () => Promise<{ blob: Blob; filename: string }>) => {
    setError(null);
    try {
      saveFile(await fetch());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the PDF');
    }
  };

  const paid = (message: string) => {
    setPaying(null);
    setReads((n) => n + 1);
    onChanged(message);
  };

  const bank = [
    ['Holder', s.bank.account_name],
    ['A/c', s.bank.account_number],
    ['IFSC', s.bank.ifsc],
    ['UPI', s.bank.upi_id],
  ].filter((b): b is [string, string] => !!b[1]);

  return (
    <li className={styles.card}>
      <button type="button" className={styles.cardHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={styles.nameRow}>
          <AppIcon name={open ? 'chevronDown' : 'chevronRight'} size={22} />
          <span className={styles.name}>{s.name}</span>
          {s.closing_minor > 0 ? (
            <span className={styles.pill} data-tone="due">
              Due {money(s.closing_minor)}
            </span>
          ) : (
            <span className={styles.pill} data-tone="settled">
              Settled
            </span>
          )}
        </span>
        <dl className={styles.figures}>
          <div>
            <dt>Opening</dt>
            <dd>{money(s.opening_minor)}</dd>
          </div>
          <div>
            <dt>Purchases</dt>
            <dd>{money(s.purchases_minor)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd data-tone="paid">{money(s.paid_minor)}</dd>
          </div>
          <div>
            <dt>Closing</dt>
            <dd data-tone={s.closing_minor > 0 ? 'due' : undefined}>{money(s.closing_minor)}</dd>
          </div>
        </dl>
      </button>

      {open ? (
        <div className={styles.detail}>
          {bank.length ? (
            <div className={styles.bank}>
              {bank.map(([label, value]) => (
                <span key={label} className={styles.chip}>
                  {label}: <strong>{value}</strong>
                  <button type="button" className={styles.copy} aria-label={`Copy ${label}`} onClick={() => void copy(label, value)}>
                    <AppIcon name={copied === label ? 'check' : 'copy'} size={18} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>No bank details on file.</p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => void download(() => supplierLedgerApi.statementPdf(ctx, s.vendor_id, query))}
            >
              <AppIcon name="document" size={22} />
              Statement
            </button>
            <button type="button" className={styles.action} onClick={() => setSending(true)}>
              <AppIcon name="share" size={22} />
              Send
            </button>
            {detail?.may_pay_all && s.closing_minor > 0 ? (
              <button type="button" className={`${styles.action} ${styles.payAll}`} onClick={() => setPaying('all')}>
                <AppIcon name="check" size={22} />
                Pay all {money(s.closing_minor)}
              </button>
            ) : null}
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {!detail ? (
            <p className={styles.muted}>Loading…</p>
          ) : detail.invoices.length ? (
            <ul className={styles.invoices} aria-label={`Invoices from ${s.name}`}>
              {detail.invoices.map((i) => (
                <li key={i.receipt_id} className={styles.invoice}>
                  <span className={styles.invoiceText}>
                    <span className={styles.invoiceTitle}>
                      {shortDay(i.date)} · {i.invoice_number}
                    </span>
                    <span className={styles.invoiceSub}>
                      {money(i.total_minor)} · paid {money(i.paid_minor)}
                      {i.earlier ? <span className={styles.earlier}> · earlier cycle</span> : null}
                    </span>
                  </span>
                  {i.due_minor > 0 ? (
                    <span className={styles.invoiceDue}>Due {money(i.due_minor)}</span>
                  ) : (
                    <span className={styles.invoicePaid}>Paid</span>
                  )}
                  {i.may_pay ? (
                    <button type="button" className={styles.record} onClick={() => setPaying(i)}>
                      Record payment
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.pdf}
                    aria-label={`${i.invoice_number} as PDF`}
                    onClick={() => void download(() => supplierLedgerApi.invoicePdf(ctx, i.receipt_id))}
                  >
                    <AppIcon name="document" size={22} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No invoices in this cycle.</p>
          )}
        </div>
      ) : null}

      {paying ? (
        <PaymentDialog
          title={paying === 'all' ? `Pay all to ${s.name}` : `Record payment · ${paying.invoice_number}`}
          due={paying === 'all' ? s.closing_minor : paying.due_minor}
          fixed={paying === 'all'}
          onCancel={() => setPaying(null)}
          onConfirm={async (amount, mode) => {
            if (paying === 'all') {
              const r = await supplierLedgerApi.payAll(ctx, s.vendor_id, { branch_id: query.branch_id, payment_mode: mode });
              paid(`Paid ${money(r.paid_minor)} to ${s.name} on ${r.invoices} ${r.invoices === 1 ? 'invoice' : 'invoices'}.`);
            } else {
              await supplierLedgerApi.recordPayment(ctx, paying.receipt_id, { amount_minor: amount, payment_mode: mode });
              paid(`Recorded ${money(amount)} paid on ${paying.invoice_number}.`);
            }
          }}
        />
      ) : null}

      {sending ? (
        <SupplierSendSheet
          name={s.name}
          phone={s.phone}
          message={statementMessage(s, detail, period)}
          pdf={() => supplierLedgerApi.statementPdf(ctx, s.vendor_id, query)}
          onClose={() => setSending(false)}
        />
      ) : null}
    </li>
  );
}

/** How much (at most what is due) and how: one invoice, or everything due. */
function PaymentDialog({
  title,
  due,
  fixed,
  onCancel,
  onConfirm,
}: {
  title: string;
  due: number;
  /** Pay all: the amount is everything due, not typed. */
  fixed: boolean;
  onCancel: () => void;
  onConfirm: (amount: number, mode: PaymentMode) => Promise<void>;
}) {
  const [amount, setAmount] = useState((due / 100).toFixed(2));
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = fixed ? due : parseRupees(amount);
  const valid = minor !== null && minor > 0 && minor <= due;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const confirm = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(minor!, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment was not saved');
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className={styles.dialog}>
        <h2 className={styles.dialogTitle} id="payment-title">
          {title}
        </h2>
        {fixed ? (
          <p className={styles.muted}>Pays every invoice still due: {money(due)}.</p>
        ) : (
          <label className={styles.field}>
            Amount (₹) — due {money(due)}
            <input inputMode="decimal" value={amount} aria-invalid={!valid} autoFocus onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        <label className={styles.field}>
          Paid by
          <select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} disabled={!valid || busy} onClick={() => void confirm()}>
            {busy ? 'Saving…' : `Pay ${valid ? money(minor!) : ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

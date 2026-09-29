import { api, apiDownload } from '@/lib/api/client';
import type { InventoryContext } from '@/lib/inventory/api';
import type { PaymentMode } from '@/lib/inventory/purchase-orders';

/**
 * The supplier ledger: what is owed to each supplier, cycle by cycle.
 * Opening (owed before the cycle) + purchases (its invoices) − paid (its
 * payments) = closing, on each branch's own days.
 */

export interface LedgerQuery {
  from: string;
  to: string;
  branch_id?: string;
  q?: string;
}

export interface LedgerFigures {
  opening_minor: number;
  purchases_minor: number;
  paid_minor: number;
  closing_minor: number;
}

export interface LedgerSupplier extends LedgerFigures {
  vendor_id: string;
  name: string;
  label: string | null;
  phone: string | null;
  bank: {
    account_name: string | null;
    account_number: string | null;
    ifsc: string | null;
    bank_name: string | null;
    upi_id: string | null;
  };
}

export interface Ledger {
  from: string;
  to: string;
  currency: string;
  summary: { purchases_minor: number; paid_minor: number; pending_minor: number };
  suppliers: LedgerSupplier[];
}

export interface SupplierInvoice {
  receipt_id: string;
  order_id: string;
  po_number: string;
  invoice_number: string;
  date: string;
  branch: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  /** From before the cycle, still due: part of the opening balance. */
  earlier: boolean;
  may_pay: boolean;
}

export interface SupplierLedgerDetail extends LedgerFigures {
  vendor: { id: string; name: string; phone: string | null };
  from: string;
  to: string;
  branch: string;
  invoices: SupplierInvoice[];
  payments: Array<{ id: string; date: string; invoice_number: string; payment_mode: PaymentMode; amount_minor: number }>;
  may_pay_all: boolean;
}

function qs(q: LedgerQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  return `?${params}`;
}

export const supplierLedgerApi = {
  ledger: (ctx: InventoryContext, q: LedgerQuery) => api.get<Ledger>(`/inventory/supplier-ledger${qs(q)}`, { companyId: ctx.companyId }),
  supplier: (ctx: InventoryContext, vendorId: string, q: LedgerQuery) =>
    api.get<SupplierLedgerDetail>(`/inventory/supplier-ledger/${vendorId}${qs(q)}`, { companyId: ctx.companyId }),
  recordPayment: (ctx: InventoryContext, receiptId: string, body: { amount_minor: number; payment_mode: PaymentMode }) =>
    api.post<{ paid_minor: number }>(`/inventory/purchase-receipts/${receiptId}/payments`, body, { companyId: ctx.companyId }),
  payAll: (ctx: InventoryContext, vendorId: string, body: { branch_id?: string; payment_mode: PaymentMode }) =>
    api.post<{ invoices: number; paid_minor: number }>(`/inventory/supplier-ledger/${vendorId}/pay-all`, body, {
      companyId: ctx.companyId,
    }),
  ledgerPdf: (ctx: InventoryContext, q: LedgerQuery) =>
    apiDownload(`/inventory/supplier-ledger/pdf${qs(q)}`, 'supplier-ledger.pdf', { companyId: ctx.companyId }),
  statementPdf: (ctx: InventoryContext, vendorId: string, q: LedgerQuery) =>
    apiDownload(`/inventory/supplier-ledger/${vendorId}/pdf${qs(q)}`, 'statement.pdf', { companyId: ctx.companyId }),
  invoicePdf: (ctx: InventoryContext, receiptId: string) =>
    apiDownload(`/inventory/purchase-receipts/${receiptId}/pdf`, 'invoice.pdf', { companyId: ctx.companyId }),
};

// ── Cycles: the first and second half of each month ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The half-month holding `today`: 1–15, or 16 to the month's end. */
export function thisCycle(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  return d <= 15 ? { from: iso(y, m, 1), to: iso(y, m, 15) } : { from: iso(y, m, 16), to: iso(y, m, lastDay(y, m)) };
}

/** The half-month before this one. */
export function lastCycle(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  if (d > 15) return { from: iso(y, m, 1), to: iso(y, m, 15) };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: iso(py, pm, 16), to: iso(py, pm, lastDay(py, pm)) };
}

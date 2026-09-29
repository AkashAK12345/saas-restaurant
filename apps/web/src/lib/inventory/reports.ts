import { api } from '@/lib/api/client';
import type { InventoryContext } from '@/lib/inventory/api';

/**
 * Inventory's Purchase Reports. Company scoped: the server covers every
 * branch where the caller holds inventory.view. A purchase counts once it has
 * arrived, on that branch's local day; amounts are quantity × price, before GST.
 */

export type InventoryReportKey = 'monthly-avg' | 'comparative' | 'consolidated' | 'closing-stock' | 'transfers';

export interface ReportOptions {
  branches: Array<{ id: string; name: string }>;
  items: Array<{ id: string; name: string; unit: string }>;
}

export interface MonthlyAvg {
  summary: {
    orders: number;
    avg_qty: number;
    avg_price_minor: number;
    total_qty: number;
    total_spend_minor: number;
    currency: string;
  };
  rows: Array<{
    id: string;
    date: string;
    supplier: string;
    branch: string;
    item: string;
    quantity: number;
    unit: string | null;
    price_minor: number;
    total_minor: number;
  }>;
  meta: { total: number; limit: number; offset: number };
}

export interface Comparative {
  a: { from: string; to: string; orders: number; spend_minor: number };
  b: { from: string; to: string; orders: number; spend_minor: number };
  delta_minor: number;
  delta_pct: number | null;
  currency: string;
  suppliers: Array<{
    vendor_id: string;
    name: string;
    a_spend_minor: number;
    b_spend_minor: number;
    delta_minor: number;
    delta_pct: number | null;
  }>;
}

export type ConsolidatedGroup = 'items' | 'suppliers' | 'branches';

export interface Consolidated {
  group: ConsolidatedGroup;
  branches: number;
  summary: { rows: number; orders: number; spend_minor: number; currency: string };
  rows: Array<{
    key: string;
    name: string;
    unit: string | null;
    orders: number;
    /** Different items bought (suppliers and branches). */
    items: number;
    /** Items only: total quantity and the last price paid, per its unit. */
    quantity: number | null;
    last_price_minor: number | null;
    spend_minor: number;
    /** The last day something arrived (YYYY-MM-DD). */
    last_buy: string | null;
    /** Branches only: still owed on the orders it received in the period. */
    outstanding_minor: number | null;
  }>;
}

export interface ClosingStock {
  summary: { items: number; total_value_minor: number; unpriced: number; currency: string };
  /** One row per item at each branch. */
  rows: Array<{
    item_id: string;
    branch_id: string;
    branch: string;
    name: string;
    category: string | null;
    unit: string;
    quantity: number;
    price_minor: number | null;
    price_source: 'last_purchase' | 'item_price' | null;
    value_minor: number;
  }>;
}

export interface TransfersReport {
  summary: { transfers: number; lines: number };
  rows: Array<{
    id: string;
    date: string;
    number: string;
    from: string;
    to: string;
    item: string;
    quantity: number;
    unit: string | null;
    kind: 'RAW' | 'PRODUCT';
  }>;
  meta: { total: number; limit: number; offset: number };
}

function qs(query: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

const get = <T>(ctx: InventoryContext, path: string, query: Record<string, string | number | undefined | null> = {}) =>
  api.get<T>(`/inventory/reports/${path}${qs(query)}`, { companyId: ctx.companyId });

export const inventoryReportsApi = {
  options: (ctx: InventoryContext) => get<ReportOptions>(ctx, 'options'),
  monthlyAvg: (
    ctx: InventoryContext,
    q: { item_id?: string; branch_id?: string; from?: string; to?: string; limit?: number; offset?: number },
  ) => get<MonthlyAvg>(ctx, 'monthly-avg', q),
  comparative: (
    ctx: InventoryContext,
    q: { branch_id?: string; a_from: string; a_to: string; b_from: string; b_to: string },
  ) => get<Comparative>(ctx, 'comparative', q),
  consolidated: (ctx: InventoryContext, q: { group: ConsolidatedGroup; from?: string; to?: string }) =>
    get<Consolidated>(ctx, 'consolidated', q),
  closingStock: (ctx: InventoryContext, q: { branch_id?: string; q?: string }) => get<ClosingStock>(ctx, 'closing-stock', q),
  transfers: (
    ctx: InventoryContext,
    q: { branch_id?: string; from?: string; to?: string; limit?: number; offset?: number },
  ) => get<TransfersReport>(ctx, 'transfers', q),
};

// ── Periods ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Sep" from "2026-09-01". */
export function shortDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "1 Sep → 30 Sep". */
export function rangeLabel(from: string, to: string): string {
  return `${shortDay(from)} → ${shortDay(to)}`;
}

/** "1 Sep → 30 Sep 2026". */
export function rangeLabelYear(from: string, to: string): string {
  return `${rangeLabel(from, to)} ${to.slice(0, 4)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The whole calendar month holding `today` (YYYY-MM-DD), `back` months earlier. */
export function monthOf(today: string, back = 0): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - back, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { from: iso(first), to: iso(last) };
}

import { api } from '@/lib/api/client';

/**
 * Inventory spans branches, so its calls carry only the company: the server
 * proves inventory.view at each branch it returns.
 */
export interface InventoryContext {
  companyId: string;
}

export interface InventoryFilters {
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  departments: string[];
}

/** Null: nothing to show — no movement ever (stock), none in the period (the rest). */
export interface InventoryCell {
  stock: number | null;
  consumed: number | null;
  purchase: number | null;
}

export interface InventoryItemRow {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  department: string | null;
  /** Branch id -> its figures. */
  cells: Record<string, InventoryCell>;
}

export interface InventoryOverview {
  branches: Array<{ id: string; name: string }>;
  summary: {
    purchase_minor: number;
    outstanding_minor: number;
    open: number;
    received: number;
    currency: string;
  };
  items: InventoryItemRow[];
  meta: { total: number; limit: number; offset: number };
}

export interface InventoryQuery {
  branch_id?: string;
  category_id?: string;
  department?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function qs(query: InventoryQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface PurchaseOptions {
  /** Branches where the caller may record a purchase. */
  outlets: Array<{ id: string; name: string }>;
  may_create_supplier: boolean;
}

export interface SupplierRef {
  id: string;
  name: string;
  /** What staff call them, when not the business name: "Seafood". */
  label: string | null;
  phone: string | null;
}

export interface NewSupplier {
  name: string;
  phone: string;
  gstin?: string;
  address?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_name?: string;
}

/** A product as a purchase picks it: priced per purchase unit, before GST. */
export interface PurchasableItem {
  id: string;
  name: string;
  /** The unit stock is counted in. */
  unit: string;
  /** The unit it is bought in (the stock unit when the same). */
  purchase_unit: string;
  /** Stock units in one purchase unit; null when the two are the same. */
  conversion_qty: number | null;
  purchase_price_minor: number | null;
  tax_rate_bps: number;
  category: string | null;
}

export interface RecordedPurchase {
  id: string;
  po_number: string;
  total_minor: number;
  currency: string;
  branch: string;
  vendor: string;
  items: number;
}

export interface TransferOptions {
  /** Outlets the caller may send from. */
  sources: Array<{ id: string; name: string }>;
  /** Every active outlet of the company. */
  destinations: Array<{ id: string; name: string }>;
}

/** A raw material with stock at the source, in its stock unit. */
export interface TransferableRaw {
  id: string;
  name: string;
  unit: string;
  on_hand: number;
}

/** A menu product: not stock-tracked, so no figure on hand. */
export interface TransferableProduct {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
}

export interface TransferStock {
  raw_materials: TransferableRaw[];
  products: TransferableProduct[];
}

export interface RecordedTransfer {
  id: string;
  number: string;
  from: string;
  to: string;
  items: number;
}

export const inventoryApi = {
  filters: (ctx: InventoryContext) => api.get<InventoryFilters>('/inventory/filters', { companyId: ctx.companyId }),
  overview: (ctx: InventoryContext, query: InventoryQuery = {}) =>
    api.get<InventoryOverview>(`/inventory/overview${qs(query)}`, { companyId: ctx.companyId }),

  purchaseOptions: (ctx: InventoryContext) =>
    api.get<PurchaseOptions>('/inventory/purchase/options', { companyId: ctx.companyId }),
  suppliers: (ctx: InventoryContext) => api.get<SupplierRef[]>('/inventory/suppliers', { companyId: ctx.companyId }),
  createSupplier: (ctx: InventoryContext, body: NewSupplier) =>
    api.post<SupplierRef>('/inventory/suppliers', body, { companyId: ctx.companyId }),
  searchItems: (ctx: InventoryContext, q: string) =>
    api.get<PurchasableItem[]>(`/inventory/items?${new URLSearchParams({ q, limit: '20' })}`, {
      companyId: ctx.companyId,
    }),
  recordPurchase: (
    ctx: InventoryContext,
    body: {
      branch_id: string;
      vendor_id: string;
      items: Array<{ item_id: string; quantity: number; rate_minor: number }>;
      note?: string;
    },
  ) => api.post<RecordedPurchase>('/inventory/purchases', body, { companyId: ctx.companyId }),

  transferOptions: (ctx: InventoryContext) =>
    api.get<TransferOptions>('/inventory/transfer/options', { companyId: ctx.companyId }),
  transferStock: (ctx: InventoryContext, branchId: string | null) =>
    api.get<TransferStock>(`/inventory/transfer/stock${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''}`, {
      companyId: ctx.companyId,
    }),
  recordTransfer: (
    ctx: InventoryContext,
    body: {
      from_branch_id: string;
      to_branch_id: string;
      lines: Array<{ kind: 'RAW' | 'PRODUCT'; id: string; quantity: number }>;
      note?: string;
    },
  ) => api.post<RecordedTransfer>('/inventory/transfers', body, { companyId: ctx.companyId }),
};

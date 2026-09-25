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

export const inventoryApi = {
  filters: (ctx: InventoryContext) => api.get<InventoryFilters>('/inventory/filters', { companyId: ctx.companyId }),
  overview: (ctx: InventoryContext, query: InventoryQuery = {}) =>
    api.get<InventoryOverview>(`/inventory/overview${qs(query)}`, { companyId: ctx.companyId }),
};

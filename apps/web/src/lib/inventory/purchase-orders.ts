import { api, apiDownload } from '@/lib/api/client';
import type { InventoryContext } from '@/lib/inventory/api';

/**
 * Purchase orders — the Purchase tab and the Receive Order screen. Company
 * scoped like the rest of inventory: the server proves the right at each
 * order's branch.
 */

export type OrderTab = 'all' | 'sent' | 'received';
export type OrderSort = 'newest' | 'oldest' | 'received' | 'supplier' | 'amount';
export type OrderStatus = 'ORDERED' | 'RECEIVED' | 'CANCELLED';
export type PaymentMode = 'CASH' | 'UPI' | 'BANK' | 'CARD' | 'CHEQUE';

export const PAYMENT_MODES: ReadonlyArray<{ value: PaymentMode; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
];

/** A delivery may carry this many photos at most. */
export const MAX_ORDER_PHOTOS = 10;

export interface OrderCard {
  id: string;
  po_number: string;
  status: OrderStatus;
  vendor: { id: string; name: string; phone: string | null };
  branch: { id: string; name: string };
  created_by: string | null;
  ordered_at: string;
  received_at: string | null;
  invoice_number: string | null;
  whatsapp_sent_at: string | null;
  items_count: number;
  received_count: number;
  /** The first few items still awaited (or, once received, on it). */
  chips: Array<{ name: string; quantity: number; unit: string | null }>;
  more_items: number;
  total_minor: number;
  paid_minor: number;
  currency: string;
  may_edit: boolean;
}

export interface OrderList {
  counts: { all: number; sent: number; cancelled: number };
  orders: OrderCard[];
  meta: { total: number; limit: number; offset: number };
}

export interface OrderQuery {
  tab?: OrderTab;
  branch_id?: string;
  vendor_id?: string;
  from?: string;
  to?: string;
  include_cancelled?: boolean;
  sort?: OrderSort;
  limit?: number;
  offset?: number;
}

export interface OrderLine {
  id: string;
  item_id: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  stock_unit: string | null;
  conversion_qty: number | null;
  unit_price_minor: number;
  tax_rate_bps: number;
  tax_minor: number;
  line_total_minor: number;
  received: boolean;
}

export interface OrderReceipt {
  id: string;
  invoice_number: string;
  total_minor: number;
  paid_minor: number;
  payment_mode: PaymentMode | null;
  received_at: string;
  items: number;
}

export interface OrderPhoto {
  id: string;
  mime_type: string;
  file_name: string | null;
  position: number;
  /** Part of a delivery already received: it stays. */
  received: boolean;
}

export interface OrderDetail {
  id: string;
  po_number: string;
  status: OrderStatus;
  source: string;
  vendor: { id: string; name: string; phone: string | null; label: string | null };
  branch: { id: string; name: string };
  created_by: string | null;
  ordered_at: string;
  received_at: string | null;
  cancelled_at: string | null;
  whatsapp_sent_at: string | null;
  notes: string | null;
  total_minor: number;
  paid_minor: number;
  currency: string;
  lines: OrderLine[];
  receipts: OrderReceipt[];
  photos: OrderPhoto[];
  may_edit: boolean;
  /** The caller may edit suppliers' details. */
  may_manage_suppliers: boolean;
}

/** A line as the Receive Order screen sends it back. */
export interface OrderLineInput {
  id?: string;
  /** Left out for an existing line with no raw material behind it. */
  item_id?: string;
  quantity: number;
  rate_minor: number;
  receive?: boolean;
}

function qs(query: OrderQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const base = '/inventory/purchase-orders';

export const purchaseOrdersApi = {
  list: (ctx: InventoryContext, query: OrderQuery = {}) =>
    api.get<OrderList>(`${base}${qs(query)}`, { companyId: ctx.companyId }),
  get: (ctx: InventoryContext, id: string) => api.get<OrderDetail>(`${base}/${id}`, { companyId: ctx.companyId }),
  /** Without lines, only the supplier changes. */
  update: (ctx: InventoryContext, id: string, body: { vendor_id?: string; lines?: OrderLineInput[] }) =>
    api.patch<OrderDetail>(`${base}/${id}`, body, { companyId: ctx.companyId }),
  receive: (
    ctx: InventoryContext,
    id: string,
    body: { vendor_id?: string; lines: OrderLineInput[]; paid_minor: number; payment_mode: PaymentMode },
  ) => api.post<OrderDetail>(`${base}/${id}/receive`, body, { companyId: ctx.companyId }),
  cancel: (ctx: InventoryContext, id: string) =>
    api.post<OrderDetail>(`${base}/${id}/cancel`, {}, { companyId: ctx.companyId }),
  markSent: (ctx: InventoryContext, id: string) =>
    api.post<OrderDetail>(`${base}/${id}/sent`, {}, { companyId: ctx.companyId }),
  uploadPhoto: (ctx: InventoryContext, id: string, body: { data: string; mime_type: string; file_name?: string }) =>
    api.post<OrderPhoto>(`${base}/${id}/photos`, body, { companyId: ctx.companyId }),
  deletePhoto: (ctx: InventoryContext, id: string, photoId: string) =>
    api.delete<void>(`${base}/${id}/photos/${photoId}`, { companyId: ctx.companyId }),
  photo: (ctx: InventoryContext, id: string, photoId: string) =>
    apiDownload(`${base}/${id}/photos/${photoId}`, 'photo', { companyId: ctx.companyId }),
  pdf: (ctx: InventoryContext, id: string) =>
    apiDownload(`${base}/${id}/pdf`, 'purchase-order.pdf', { companyId: ctx.companyId }),
};

// ── Sending an order on WhatsApp ────────────────────────────────────────────

/** A number wa.me can dial: digits only, India's code added to a bare ten. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/**
 * The message a supplier receives: the order line by line — what is still
 * awaited, or everything once it has all arrived.
 */
export function orderMessage(order: Pick<OrderDetail, 'po_number' | 'branch' | 'vendor' | 'lines'>): string {
  const awaited = order.lines.filter((l) => !l.received);
  const lines = (awaited.length ? awaited : order.lines).map(
    (l, i) => `${i + 1}. ${l.name} — ${QTY.format(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`,
  );
  return [
    `*Purchase order ${order.po_number}*`,
    `To: ${order.vendor.name}`,
    `Deliver to: ${order.branch.name}`,
    '',
    ...lines,
    '',
    'Please confirm. Thank you.',
  ].join('\n');
}

/** wa.me link with the message; without a number WhatsApp asks whom to send to. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}

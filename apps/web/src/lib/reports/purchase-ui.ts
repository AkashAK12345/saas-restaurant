import type { MetricIcon } from '@/components/reports/metric-grid';

/**
 * Presentation-only helpers for the Purchase Reports screen
 * (`/reports/purchase`): one set of cards over two views of the same orders,
 * `purchase.by_vendor` and `purchase.by_item`.
 */

export const PURCHASE_ICONS: Readonly<Record<string, MetricIcon>> = {
  total_amount: { icon: 'rupee', tone: 'red' },
  total_items: { icon: 'archive', tone: 'blue' },
  vendors: { icon: 'truck', tone: 'amber' },
  whatsapp_sent: { icon: 'send', tone: 'red' },
};

/** The four cards; the order count stays in the export. */
export const PURCHASE_CARDS = ['total_amount', 'total_items', 'vendors', 'whatsapp_sent'] as const;

export type PurchaseView = 'by_vendor' | 'by_item';

export const PURCHASE_VIEWS: ReadonlyArray<{ key: PurchaseView; label: string; report: string }> = [
  { key: 'by_vendor', label: 'By Vendor', report: 'purchase.by_vendor' },
  { key: 'by_item', label: 'By Item', report: 'purchase.by_item' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Sep 26 – 24 Sep 26" — the date pill's label. */
export function pillRangeLabel(from: string, to: string): string {
  const short = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
  };
  return from === to ? short(from) : `${short(from)} – ${short(to)}`;
}

/**
 * Rows whose vendor or item names contain the search, ignoring case. The
 * search box narrows what is already loaded; it never goes to the server.
 */
export function matchesSearch(row: Record<string, unknown>, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return ['vendor', 'vendors', 'item'].some((key) =>
    String(row[key] ?? '')
      .toLowerCase()
      .includes(needle),
  );
}

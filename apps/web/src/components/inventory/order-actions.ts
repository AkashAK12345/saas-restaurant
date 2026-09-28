import type { InventoryContext } from '@/lib/inventory/api';
import {
  orderMessage,
  purchaseOrdersApi,
  whatsappLink,
  type OrderDetail,
} from '@/lib/inventory/purchase-orders';

/** The order's print view, in a tab of its own: A4, or a thermal slip. */
export function printOrder(id: string, format: 'a4' | 'thermal' = 'a4'): void {
  window.open(`/inventory/purchase/${id}/print?format=${format}`, '_blank');
}

/**
 * Send an order to its supplier on WhatsApp, and record that it went. The
 * tab opens BEFORE anything is awaited, so no pop-up blocker takes it for an
 * unasked window; it is pointed at WhatsApp once the order is read.
 * Returns the order as it now stands.
 */
export async function sendOnWhatsApp(ctx: InventoryContext, id: string, known?: OrderDetail): Promise<OrderDetail> {
  const tab = window.open('', '_blank');
  try {
    const order = known ?? (await purchaseOrdersApi.get(ctx, id));
    const url = whatsappLink(order.vendor.phone, orderMessage(order));
    if (tab) tab.location.href = url;
    else window.location.href = url;
    return order.status === 'ORDERED' && order.may_edit ? await purchaseOrdersApi.markSent(ctx, id) : order;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

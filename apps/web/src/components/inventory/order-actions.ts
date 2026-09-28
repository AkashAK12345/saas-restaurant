/** The order's print view, in a tab of its own: A4, or a thermal slip. */
export function printOrder(id: string, format: 'a4' | 'thermal' = 'a4'): void {
  window.open(`/inventory/purchase/${id}/print?format=${format}`, '_blank');
}

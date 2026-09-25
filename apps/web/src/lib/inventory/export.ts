import type { InventoryItemRow } from './api';

/** One CSV field, quoted when it needs to be. */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The inventory grid as CSV: item, unit, category and department, then
 * Stock, Consumed and Purchase for each branch shown. A blank cell is the
 * grid's dash — nothing to show — not a zero.
 */
export function itemsToCsv(
  branches: ReadonlyArray<{ id: string; name: string }>,
  items: readonly InventoryItemRow[],
): string {
  const header = [
    'Item',
    'Unit',
    'Category',
    'Department',
    ...branches.flatMap((b) => [`${b.name} Stock`, `${b.name} Consumed`, `${b.name} Purchase`]),
  ];
  const rows = items.map((item) => [
    item.name,
    item.unit,
    item.category,
    item.department,
    ...branches.flatMap((b) => {
      const c = item.cells[b.id];
      return [c?.stock, c?.consumed, c?.purchase];
    }),
  ]);
  // A byte-order mark so Excel reads "₹" and other non-ASCII names correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(field).join(',')).join('\r\n');
}

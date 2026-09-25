import type { PrismaClient } from '@samco/database';
import { STOCK_DEPARTMENTS } from '../tasks/reference-checklists.js';

/**
 * Loading a company's product list from a spreadsheet.
 *
 * THE SHEET
 *   A header row, in any order and any case — the first row that names both
 *   the item and its unit, so a report title above it (as a POS "Raw Material
 *   Report" export has) is skipped. Recognised:
 *     Name (Item / Item Name / Product)            — required
 *     Consumption Unit (Unit / UOM / Stock Unit)   — required: the unit stock
 *                                                    is counted in
 *     Purchase Unit + Conversion Qty               — when bought in another
 *                                                    unit: a 50 Kg bag is
 *                                                    "Bag", 50
 *     Category, Sub Category                       — created/kept as given
 *     Department                                   — one of the kitchen
 *                                                    departments (Indian, …)
 *     Purchase Price, Transfer Price               — per purchase unit, in
 *                                                    rupees; 0 means none
 *     Tax(%) (GST % / Tax %)                       — 18 is 18%
 *     HSN, Barcode/Short Code, Active (Yes/No)
 *   Any other header that names one of the company's branches is that
 *   branch's OPENING stock for the item. Other headers are ignored, and
 *   reported. Blank rows are skipped.
 *
 * RUNNING IT TWICE IS SAFE
 *   An item is matched on name + unit and updated rather than duplicated; an
 *   opening balance is only written for a branch where the item has no stock
 *   movement yet, so a re-run never doubles stock.
 */

const NAME_HEADERS = ['name', 'item', 'item name', 'product', 'product name'];
const UNIT_HEADERS = ['consumption unit', 'unit', 'uom', 'units', 'stock unit'];
const PURCHASE_UNIT_HEADERS = ['purchase unit'];
/** How far down a header row is looked for. */
const HEADER_SEARCH_ROWS = 20;

export interface ParsedItem {
  row: number;
  name: string;
  unit: string;
  category: string | null;
  sub_category: string | null;
  department: string | null;
  purchase_unit: string | null;
  conversion_qty: number | null;
  purchase_price_minor: number | null;
  transfer_price_minor: number | null;
  tax_rate_bps: number | null;
  hsn: string | null;
  short_code: string | null;
  is_active: boolean;
  /** Branch name (as the company spells it) -> opening quantity. */
  opening: Record<string, number>;
}

export interface ParsedSheet {
  items: ParsedItem[];
  errors: string[];
  /** Headers that were neither a known column nor a branch. */
  ignored: string[];
}

const norm = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => norm(v).toLowerCase().replace(/\s+/g, ' ');

/** A non-negative number from a cell ("1,200.50", 12), or undefined if not one. */
function amount(raw: unknown): number | undefined {
  const s = norm(raw).replace(/,/g, '');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Turn a sheet's rows into items, or say what is wrong. */
export function parseInventorySheet(rows: readonly unknown[][], branchNames: readonly string[]): ParsedSheet {
  const errors: string[] = [];
  const items: ParsedItem[] = [];

  const headerIndex = rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((r) => r.some((c) => NAME_HEADERS.includes(key(c))) && r.some((c) => [...UNIT_HEADERS, ...PURCHASE_UNIT_HEADERS].includes(key(c))));
  if (headerIndex < 0) {
    return { items, errors: ['No header row naming both "Name" and "Unit" in the first rows'], ignored: [] };
  }
  const headerCells = rows[headerIndex];
  const header = headerCells.map(key);
  const find = (names: readonly string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    name: find(NAME_HEADERS),
    unit: find(UNIT_HEADERS),
    purchaseUnit: find(PURCHASE_UNIT_HEADERS),
    conversion: find(['conversion qty', 'conversion quantity', 'conversion']),
    category: find(['category']),
    subCategory: find(['sub category', 'subcategory', 'sub-category']),
    department: find(['department', 'dept']),
    purchasePrice: find(['purchase price']),
    transferPrice: find(['transfer price']),
    tax: find(['tax(%)', 'tax (%)', 'tax %', 'gst %', 'gst(%)', 'gst']),
    hsn: find(['hsn', 'hsn code']),
    shortCode: find(['barcode/short code', 'short code', 'barcode']),
    active: find(['active']),
  };
  // A sheet with only a purchase unit counts stock in it.
  const unitCol = col.unit >= 0 ? col.unit : col.purchaseUnit;
  const known = new Set(Object.values(col).filter((i) => i >= 0));

  const branchCols = new Map<number, string>();
  const ignored = new Set<string>();
  header.forEach((h, i) => {
    if (!h || known.has(i)) return;
    const branch = branchNames.find((b) => key(b) === h);
    if (branch) branchCols.set(i, branch);
    else ignored.add(norm(headerCells[i]));
  });

  const departments = new Map(STOCK_DEPARTMENTS.map((d) => [key(d), d]));
  const text = (cells: unknown[], i: number, max: number) => (i >= 0 ? norm(cells[i]).slice(0, max) || null : null);
  const seen = new Set<string>();

  rows.slice(headerIndex + 1).forEach((cells, index) => {
    const row = headerIndex + index + 2;
    if (cells.every((c) => norm(c) === '')) return;
    const fail = (why: string) => errors.push(`Row ${row}: ${why}`);

    const name = norm(cells[col.name]).replace(/\s+/g, ' ');
    const unit = norm(cells[unitCol]);
    if (!name || !unit) return fail('needs both a name and a unit');
    if (name.length > 160 || unit.length > 24) return fail('name is over 160 characters or unit over 24');
    const dup = `${key(name)}|${key(unit)}`;
    if (seen.has(dup)) return fail(`"${name}" (${unit}) appears more than once`);

    const rawDept = col.department >= 0 ? norm(cells[col.department]) : '';
    const department = rawDept ? departments.get(key(rawDept)) : null;
    if (rawDept && !department) {
      return fail(`department "${rawDept}" is not one of ${STOCK_DEPARTMENTS.join(', ')}`);
    }

    // Bought in another unit only when it says so AND says how many.
    let purchaseUnit: string | null = null;
    let conversion: number | null = null;
    const rawPurchaseUnit = col.purchaseUnit >= 0 ? norm(cells[col.purchaseUnit]) : '';
    if (rawPurchaseUnit && key(rawPurchaseUnit) !== key(unit)) {
      const n = col.conversion >= 0 ? amount(cells[col.conversion]) : undefined;
      if (!n) return fail(`bought in "${rawPurchaseUnit}" but counted in "${unit}", with no conversion quantity`);
      purchaseUnit = rawPurchaseUnit.slice(0, 24);
      conversion = n;
    }

    const price = (i: number, what: string): number | null | false => {
      if (i < 0 || norm(cells[i]) === '') return null;
      const n = amount(cells[i]);
      if (n === undefined) {
        fail(`${what} "${norm(cells[i])}" is not an amount`);
        return false;
      }
      // Zero is how the export writes "no price", not a free item.
      return n === 0 ? null : Math.round(n * 100);
    };
    const purchasePrice = price(col.purchasePrice, 'purchase price');
    const transferPrice = price(col.transferPrice, 'transfer price');
    if (purchasePrice === false || transferPrice === false) return;

    let tax: number | null = null;
    if (col.tax >= 0 && norm(cells[col.tax]) !== '') {
      const n = amount(cells[col.tax]);
      if (n === undefined || n > 100) return fail(`tax "${norm(cells[col.tax])}" is not a percentage`);
      tax = Math.round(n * 100);
    }

    const opening: Record<string, number> = {};
    for (const [c, branch] of branchCols) {
      const raw = norm(cells[c]);
      if (!raw) continue;
      const n = amount(raw);
      if (n === undefined || !/^\d+(\.\d{1,3})?$/.test(String(n))) {
        return fail(`opening stock "${raw}" at ${branch} is not a quantity (up to 3 decimals)`);
      }
      if (n > 0) opening[branch] = n;
    }

    seen.add(dup);
    items.push({
      row,
      name,
      unit,
      category: text(cells, col.category, 80),
      sub_category: text(cells, col.subCategory, 80),
      department: department ?? null,
      purchase_unit: purchaseUnit,
      conversion_qty: conversion,
      purchase_price_minor: purchasePrice,
      transfer_price_minor: transferPrice,
      tax_rate_bps: tax,
      hsn: text(cells, col.hsn, 16),
      short_code: text(cells, col.shortCode, 40),
      is_active: col.active < 0 || key(cells[col.active]) !== 'no',
      opening,
    });
  });

  return { items, errors, ignored: [...ignored] };
}

export interface ImportResult {
  created: number;
  updated: number;
  categories: number;
  openings: number;
}

/**
 * Write parsed items for one company, in one transaction: all or nothing.
 * Branches are the company's own, matched by the names the sheet used.
 */
export async function importInventory(
  prisma: PrismaClient,
  companyId: string,
  items: readonly ParsedItem[],
  branches: ReadonlyArray<{ id: string; name: string }>,
): Promise<ImportResult> {
  const branchId = new Map(branches.map((b) => [b.name, b.id]));
  return prisma.$transaction(
    async (tx) => {
      const result: ImportResult = { created: 0, updated: 0, categories: 0, openings: 0 };
      const categoryIds = new Map<string, string>();
      for (const c of await tx.inventoryCategory.findMany({ where: { company_id: companyId } })) {
        categoryIds.set(c.name.toLowerCase(), c.id);
      }
      for (const item of items) {
        let categoryId: string | null = null;
        if (item.category) {
          categoryId = categoryIds.get(item.category.toLowerCase()) ?? null;
          if (!categoryId) {
            const created = await tx.inventoryCategory.create({ data: { company_id: companyId, name: item.category } });
            categoryId = created.id;
            categoryIds.set(item.category.toLowerCase(), created.id);
            result.categories += 1;
          }
        }
        const details = {
          category_id: categoryId,
          sub_category: item.sub_category,
          department: item.department,
          purchase_unit: item.purchase_unit,
          conversion_qty: item.conversion_qty,
          purchase_price_minor: item.purchase_price_minor,
          transfer_price_minor: item.transfer_price_minor,
          tax_rate_bps: item.tax_rate_bps,
          hsn: item.hsn,
          short_code: item.short_code,
          is_active: item.is_active,
        };
        const existing = await tx.inventoryItem.findUnique({
          where: { company_id_name_unit: { company_id: companyId, name: item.name, unit: item.unit } },
        });
        const saved = existing
          ? await tx.inventoryItem.update({ where: { id: existing.id }, data: details })
          : await tx.inventoryItem.create({
              data: { company_id: companyId, name: item.name, unit: item.unit, ...details },
            });
        if (existing) result.updated += 1;
        else result.created += 1;

        for (const [branchName, quantity] of Object.entries(item.opening)) {
          const id = branchId.get(branchName);
          if (!id) continue;
          const moved = await tx.stockMovement.count({ where: { item_id: saved.id, branch_id: id } });
          if (moved > 0) continue;
          await tx.stockMovement.create({
            data: {
              company_id: companyId,
              branch_id: id,
              item_id: saved.id,
              kind: 'OPENING',
              quantity,
              note: 'Opening stock (import)',
            },
          });
          result.openings += 1;
        }
      }
      return result;
    },
    { timeout: 300_000 },
  );
}

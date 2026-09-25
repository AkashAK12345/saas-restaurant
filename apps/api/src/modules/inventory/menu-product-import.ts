import type { PrismaClient } from '@samco/database';

/**
 * Loading a company's menu products from a spreadsheet — a POS menu export,
 * or any sheet with the same headers.
 *
 * THE SHEET
 *   A header row (the first naming the product; a report title above it is
 *   skipped). Recognised, any order/case:
 *     Name / Product / Item Name   — required
 *     Category, Unit, Short Code (or Code / Barcode / SKU),
 *     Price (or Rate / Selling Price), Status / Active (Active / Inactive,
 *     Yes / No)
 *   Other headers are ignored, and reported. Blank rows are skipped.
 *
 * Products are not stock-tracked: they appear on a transfer, move no stock.
 *
 * RUNNING IT TWICE IS SAFE: a product is matched on its name and updated
 * rather than duplicated.
 */

export interface ParsedMenuProduct {
  row: number;
  name: string;
  category: string | null;
  unit: string | null;
  short_code: string | null;
  price_minor: number | null;
  is_active: boolean;
}

export interface ParsedMenuProducts {
  products: ParsedMenuProduct[];
  errors: string[];
  ignored: string[];
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const key = (v: unknown) => norm(v).toLowerCase();
const HEADER_SEARCH_ROWS = 20;

const COLUMNS = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'menu item', 'menu item name'],
  category: ['category', 'category name', 'group', 'menu category'],
  unit: ['unit', 'uom'],
  shortCode: ['short code', 'shortcode', 'code', 'barcode', 'sku', 'item code'],
  price: ['price', 'rate', 'selling price', 'sale price', 'mrp'],
  status: ['status', 'active', 'is active'],
} as const;

const INACTIVE = new Set(['inactive', 'no', 'n', 'false', '0', 'disabled']);

export function parseMenuProductSheet(rows: readonly unknown[][]): ParsedMenuProducts {
  const errors: string[] = [];
  const products: ParsedMenuProduct[] = [];
  const headerIndex = rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((r) => r.some((c) => (COLUMNS.name as readonly string[]).includes(key(c))));
  if (headerIndex < 0) return { products, errors: ['No header row naming "Name" or "Product"'], ignored: [] };

  const headerCells = rows[headerIndex];
  const header = headerCells.map(key);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => (names as readonly string[]).includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  const known = new Set(Object.values(col).filter((i) => i >= 0));
  const ignored = [...new Set(header.flatMap((h, i) => (h && !known.has(i) ? [norm(headerCells[i])] : [])))];

  const cell = (cells: unknown[], i: number): string => (i < 0 ? '' : norm(cells[i]));

  const seen = new Set<string>();
  rows.slice(headerIndex + 1).forEach((cells, index) => {
    const row = headerIndex + index + 2;
    if (cells.every((c) => norm(c) === '')) return;
    const fail = (why: string) => errors.push(`Row ${row}: ${why}`);

    const name = cell(cells, col.name);
    if (!name) return fail('needs a name');
    if (name.length > 160) return fail('name is over 160 characters');
    if (seen.has(key(name))) return fail(`"${name}" appears more than once`);

    const category = cell(cells, col.category);
    if (category.length > 80) return fail('category is over 80 characters');
    const unit = cell(cells, col.unit);
    if (unit.length > 24) return fail('unit is over 24 characters');
    const shortCode = cell(cells, col.shortCode);
    if (shortCode.length > 40) return fail('short code is over 40 characters');

    let price: number | null = null;
    const rawPrice = cell(cells, col.price).replace(/[₹,\s]/g, '');
    if (rawPrice) {
      const n = Number(rawPrice);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return fail(`price "${cell(cells, col.price)}" is not an amount`);
      // Zero is how exports say "no price".
      price = n === 0 ? null : Math.round(n * 100);
    }

    seen.add(key(name));
    products.push({
      row,
      name,
      category: category || null,
      unit: unit || null,
      short_code: shortCode || null,
      price_minor: price,
      is_active: !INACTIVE.has(key(cell(cells, col.status))),
    });
  });

  return { products, errors, ignored };
}

/** Write parsed products for one company, in one transaction. */
export async function importMenuProducts(
  prisma: PrismaClient,
  companyId: string,
  products: readonly ParsedMenuProduct[],
): Promise<{ created: number; updated: number }> {
  return prisma.$transaction(
    async (tx) => {
      const result = { created: 0, updated: 0 };
      for (const { row: _row, name, ...details } of products) {
        const existing = await tx.menuProduct.findUnique({ where: { company_id_name: { company_id: companyId, name } } });
        if (existing) {
          await tx.menuProduct.update({ where: { id: existing.id }, data: details });
          result.updated += 1;
        } else {
          await tx.menuProduct.create({ data: { company_id: companyId, name, ...details } });
          result.created += 1;
        }
      }
      return result;
    },
    { timeout: 120_000 },
  );
}

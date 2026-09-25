import type { PrismaClient } from '@samco/database';

/**
 * Loading a company's suppliers from a spreadsheet — the POS "Supplier"
 * export, or any sheet with the same headers.
 *
 * THE SHEET
 *   A header row (the first naming "Name" and one of Company / Phone /
 *   GST No; a report title above it is skipped). Recognised, any order/case:
 *     Name, Company          — at least one; the supplier is stored under its
 *                              COMPANY, since exports reuse a Name as a label
 *                              for what is bought ("Seafood" for four
 *                              different businesses). A Name that differs is
 *                              kept as the supplier's label.
 *     Phone, Email, Registered Under GST (Yes/No), GST No, Address, City,
 *     State, Pin Code, Type (Purchase / Sale / Both), TCS %, Status
 *     (Active / Inactive), FSSAI Lic No., PAN
 *   Other headers are ignored, and reported. Blank rows are skipped.
 *
 * RUNNING IT TWICE IS SAFE: a supplier is matched on its business name and
 * updated rather than duplicated.
 */

export interface ParsedSupplier {
  row: number;
  name: string;
  label: string | null;
  phone: string | null;
  email: string | null;
  type: 'PURCHASE' | 'SALE' | 'BOTH';
  is_active: boolean;
  gst_registered: boolean;
  gstin: string | null;
  tcs_rate_bps: number;
  fssai_no: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface ParsedSuppliers {
  suppliers: ParsedSupplier[];
  errors: string[];
  ignored: string[];
}

const norm = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => norm(v).toLowerCase().replace(/\s+/g, ' ');
const HEADER_SEARCH_ROWS = 20;

const COLUMNS = {
  name: ['name', 'supplier', 'supplier name', 'vendor', 'vendor name'],
  company: ['company', 'company name', 'business name'],
  phone: ['phone', 'mobile', 'phone number', 'contact number'],
  email: ['email', 'e-mail'],
  gstRegistered: ['registered under gst'],
  gstin: ['gst no', 'gst no.', 'gstin', 'gst number'],
  address: ['address'],
  city: ['city'],
  state: ['state'],
  pincode: ['pin code', 'pincode', 'pin'],
  type: ['type'],
  tcs: ['tax collected at source(tcs %)', 'tcs %', 'tcs(%)', 'tcs'],
  status: ['status'],
  fssai: ['fssai lic no.', 'fssai lic no', 'fssai', 'fssai no'],
  pan: ['pan'],
} as const;

const TYPES: Record<string, ParsedSupplier['type']> = { purchase: 'PURCHASE', sale: 'SALE', both: 'BOTH' };

export function parseSupplierSheet(rows: readonly unknown[][]): ParsedSuppliers {
  const errors: string[] = [];
  const suppliers: ParsedSupplier[] = [];
  const headerIndex = rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex(
      (r) =>
        r.some((c) => (COLUMNS.name as readonly string[]).includes(key(c))) &&
        r.some((c) => ([...COLUMNS.company, ...COLUMNS.phone, ...COLUMNS.gstin] as string[]).includes(key(c))),
    );
  if (headerIndex < 0) {
    return { suppliers, errors: ['No header row naming "Name" with "Company", "Phone" or "GST No"'], ignored: [] };
  }
  const headerCells = rows[headerIndex];
  const header = headerCells.map(key);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => (names as readonly string[]).includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  const known = new Set(Object.values(col).filter((i) => i >= 0));
  const ignored = [...new Set(header.flatMap((h, i) => (h && !known.has(i) ? [norm(headerCells[i])] : [])))];

  /** A cell as text; a number keeps its digits ("4426426025", not "4.4e9"). */
  const cell = (cells: unknown[], i: number): string => {
    if (i < 0) return '';
    const v = cells[i];
    return typeof v === 'number' ? String(v) : norm(v);
  };

  const seen = new Set<string>();
  rows.slice(headerIndex + 1).forEach((cells, index) => {
    const row = headerIndex + index + 2;
    if (cells.every((c) => norm(c) === '')) return;
    const fail = (why: string) => errors.push(`Row ${row}: ${why}`);

    const label = cell(cells, col.name).replace(/\s+/g, ' ');
    const company = cell(cells, col.company).replace(/\s+/g, ' ');
    const name = company || label;
    if (!name) return fail('needs a name or a company');
    if (name.length > 160) return fail('name is over 160 characters');
    if (seen.has(key(name))) return fail(`"${name}" appears more than once`);

    const rawType = key(cell(cells, col.type));
    const type = rawType ? TYPES[rawType] : 'PURCHASE';
    if (!type) return fail(`type "${cell(cells, col.type)}" is not Purchase, Sale or Both`);

    let tcs = 0;
    const rawTcs = cell(cells, col.tcs);
    if (rawTcs) {
      const n = Number(rawTcs);
      if (!Number.isFinite(n) || n < 0 || n > 100) return fail(`TCS "${rawTcs}" is not a percentage`);
      tcs = Math.round(n * 100);
    }

    const text = (i: number, max: number, what: string): string | null | false => {
      const v = cell(cells, i);
      if (!v) return null;
      if (v.length > max) {
        fail(`${what} is over ${max} characters`);
        return false;
      }
      return v;
    };
    const phone = text(col.phone, 32, 'phone');
    const email = text(col.email, 160, 'email');
    const gstin = text(col.gstin, 20, 'GST number');
    const fssai = text(col.fssai, 20, 'FSSAI number');
    const pan = text(col.pan, 12, 'PAN');
    const city = text(col.city, 80, 'city');
    const state = text(col.state, 80, 'state');
    const pincode = text(col.pincode, 10, 'pin code');
    if ([phone, email, gstin, fssai, pan, city, state, pincode].includes(false)) return;

    seen.add(key(name));
    suppliers.push({
      row,
      name,
      label: label && key(label) !== key(name) ? label.slice(0, 80) : null,
      phone: phone as string | null,
      email: email as string | null,
      type,
      is_active: key(cell(cells, col.status)) !== 'inactive',
      gst_registered: key(cell(cells, col.gstRegistered)) === 'yes',
      gstin: gstin as string | null,
      tcs_rate_bps: tcs,
      fssai_no: fssai as string | null,
      pan: pan as string | null,
      address: cell(cells, col.address) || null,
      city: city as string | null,
      state: state as string | null,
      pincode: pincode as string | null,
    });
  });

  return { suppliers, errors, ignored };
}

/** Write parsed suppliers for one company, in one transaction. */
export async function importSuppliers(
  prisma: PrismaClient,
  companyId: string,
  suppliers: readonly ParsedSupplier[],
): Promise<{ created: number; updated: number }> {
  return prisma.$transaction(
    async (tx) => {
      const result = { created: 0, updated: 0 };
      for (const { row: _row, name, ...details } of suppliers) {
        const existing = await tx.vendor.findUnique({ where: { company_id_name: { company_id: companyId, name } } });
        if (existing) {
          await tx.vendor.update({ where: { id: existing.id }, data: details });
          result.updated += 1;
        } else {
          await tx.vendor.create({ data: { company_id: companyId, name, ...details } });
          result.created += 1;
        }
      }
      return result;
    },
    { timeout: 120_000 },
  );
}

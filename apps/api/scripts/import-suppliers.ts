/**
 * Import a company's suppliers from a spreadsheet (.xlsx or .csv).
 *
 *   npx tsx scripts/import-suppliers.ts <file> [--company "<name or id>"] [--dry-run]
 *
 * Run from apps/api. See src/modules/inventory/supplier-import.ts for the
 * sheet's format.
 */
import path from 'node:path';
import { importSuppliers, parseSupplierSheet } from '../src/modules/inventory/supplier-import.js';
import { arg, pickCompany, PrismaClient, readRows } from './read-sheet.js';

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: npx tsx scripts/import-suppliers.ts <file.xlsx|file.csv> [--company "<name or id>"] [--dry-run]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const company = await pickCompany(prisma, arg('--company'));
    const parsed = parseSupplierSheet(await readRows(path.resolve(file)));
    if (parsed.ignored.length) console.log(`Ignored columns: ${parsed.ignored.join(', ')}`);
    if (parsed.errors.length) {
      console.error(`Nothing imported — fix these first:\n  ${parsed.errors.join('\n  ')}`);
      process.exit(1);
    }
    const inactive = parsed.suppliers.filter((s) => !s.is_active).length;
    console.log(
      `${company.name}: ${parsed.suppliers.length} suppliers read from ${path.basename(file)} (${inactive} inactive).`,
    );
    if (process.argv.includes('--dry-run')) {
      console.log('Dry run: nothing written.');
      return;
    }
    const result = await importSuppliers(prisma, company.id, parsed.suppliers);
    console.log(`Done: ${result.created} created, ${result.updated} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

/**
 * Import a company's products from a spreadsheet (.xlsx or .csv).
 *
 *   npx tsx scripts/import-inventory.ts <file> [--company "<name or id>"] [--dry-run]
 *
 * Run from apps/api. Reads DATABASE_URL from the repo-root .env. With one
 * company in the database --company may be left out. --dry-run checks the
 * sheet and reports what would change without writing anything.
 * See src/modules/inventory/inventory-import.ts for the sheet's format.
 */
import path from 'node:path';
import { importInventory, parseInventorySheet } from '../src/modules/inventory/inventory-import.js';
import { arg, pickCompany, PrismaClient, readRows } from './read-sheet.js';

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: npx tsx scripts/import-inventory.ts <file.xlsx|file.csv> [--company "<name or id>"] [--dry-run]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const company = await pickCompany(prisma, arg('--company'));
    const branches = await prisma.branch.findMany({ where: { company_id: company.id }, select: { id: true, name: true } });

    const parsed = parseInventorySheet(await readRows(path.resolve(file)), branches.map((b) => b.name));
    if (parsed.ignored.length) console.log(`Ignored columns: ${parsed.ignored.join(', ')}`);
    if (parsed.errors.length) {
      console.error(`Nothing imported — fix these first:\n  ${parsed.errors.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`${company.name}: ${parsed.items.length} items read from ${path.basename(file)}.`);
    if (process.argv.includes('--dry-run')) {
      console.log('Dry run: nothing written.');
      return;
    }
    const result = await importInventory(prisma, company.id, parsed.items, branches);
    console.log(
      `Done: ${result.created} created, ${result.updated} updated, ${result.categories} new categories, ${result.openings} opening balances.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();

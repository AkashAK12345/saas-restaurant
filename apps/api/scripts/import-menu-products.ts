/**
 * Import a company's menu products from a spreadsheet (.xlsx or .csv).
 *
 *   npx tsx scripts/import-menu-products.ts <file> [--company "<name or id>"] [--dry-run]
 *
 * Run from apps/api. See src/modules/inventory/menu-product-import.ts for the
 * sheet's format.
 */
import path from 'node:path';
import { importMenuProducts, parseMenuProductSheet } from '../src/modules/inventory/menu-product-import.js';
import { arg, pickCompany, PrismaClient, readRows } from './read-sheet.js';

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: npx tsx scripts/import-menu-products.ts <file.xlsx|file.csv> [--company "<name or id>"] [--dry-run]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const company = await pickCompany(prisma, arg('--company'));
    const parsed = parseMenuProductSheet(await readRows(path.resolve(file)));
    if (parsed.ignored.length) console.log(`Ignored columns: ${parsed.ignored.join(', ')}`);
    if (parsed.errors.length) {
      console.error(`Nothing imported — fix these first:\n  ${parsed.errors.join('\n  ')}`);
      process.exit(1);
    }
    const inactive = parsed.products.filter((p) => !p.is_active).length;
    console.log(`${company.name}: ${parsed.products.length} products read from ${path.basename(file)} (${inactive} inactive).`);
    if (process.argv.includes('--dry-run')) {
      console.log('Dry run: nothing written.');
      return;
    }
    const result = await importMenuProducts(prisma, company.id, parsed.products);
    console.log(`Done: ${result.created} created, ${result.updated} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

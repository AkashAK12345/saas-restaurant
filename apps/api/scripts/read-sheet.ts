import path from 'node:path';
import ExcelJS from 'exceljs';
import { config } from 'dotenv';
import database from '@samco/database';

// Scripts run from apps/api; the database settings live in the repo root.
config({ path: path.resolve(process.cwd(), '../../.env') });

/** The database package is CommonJS: take its exports off the default import. */
export const { PrismaClient } = database;

/** The first sheet of an .xlsx, or a .csv, as rows of plain cell values. */
export async function readRows(file: string): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  const sheet = file.toLowerCase().endsWith('.csv')
    ? await workbook.csv.readFile(file)
    : (await workbook.xlsx.readFile(file)).worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    rows.push(
      (row.values as unknown[]).slice(1).map((v) => {
        if (v && typeof v === 'object') {
          if ('result' in v) return (v as { result: unknown }).result;
          if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
          if ('text' in v) return (v as { text: unknown }).text;
        }
        return v;
      }),
    );
  });
  return rows;
}

/** A named company (by name or id), or the only one; exits with the list otherwise. */
export async function pickCompany(
  prisma: InstanceType<typeof PrismaClient>,
  wanted: string | undefined,
): Promise<{ id: string; name: string }> {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const company = wanted
    ? companies.find((c) => c.id === wanted || c.name.toLowerCase() === wanted.toLowerCase())
    : companies.length === 1
      ? companies[0]
      : undefined;
  if (!company) {
    console.error(
      wanted
        ? `No company "${wanted}". Companies: ${companies.map((c) => c.name).join(', ')}`
        : `Several companies — pass --company. Companies: ${companies.map((c) => c.name).join(', ')}`,
    );
    process.exit(1);
  }
  return company;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

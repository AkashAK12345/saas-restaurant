import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

/**
 * The browser suite's database, and the one guard every destructive step goes
 * through.
 *
 * The suite wipes its database at the start of every run — every user,
 * company, role and display device — so aiming it at the wrong database would
 * destroy real work. The rule is deliberately blunt: the database NAME must
 * contain "e2e", or nothing runs. Nothing is "corrected" or guessed.
 *
 * Database URLs carry a password, so none of these functions ever print one;
 * errors name the database only.
 */
export const BROWSER_E2E_DATABASE = 'samco_browser_e2e';

/** apps/web/e2e/support → repository root. */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Throws unless `url` names a database whose name contains "e2e". */
export function assertE2eDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('[browser-e2e] No database URL is configured. Aborting.');
  let name: string;
  try {
    name = databaseName(url);
  } catch {
    throw new Error('[browser-e2e] The database URL could not be parsed. Aborting.');
  }
  if (!name.includes('e2e')) {
    throw new Error(`[browser-e2e] Refusing to use database "${name}": its name must contain "e2e". Aborting.`);
  }
  return url;
}

/**
 * The suite's own database: SAMCO_BROWSER_E2E_DATABASE_URL when set, otherwise
 * `samco_browser_e2e` on the same server and account as the development
 * database. That is read from packages/database/.env first — the file Prisma
 * itself loads, and so the connection the API really uses — then the
 * repository .env. Either way the result has passed the guard.
 */
export function browserE2eDatabaseUrl(): string {
  const explicit = process.env.SAMCO_BROWSER_E2E_DATABASE_URL;
  if (explicit) return assertE2eDatabaseUrl(explicit);

  const base =
    readEnvValue(path.join(REPO_ROOT, 'packages', 'database', '.env'), 'DATABASE_URL') ??
    readEnvValue(path.join(REPO_ROOT, '.env'), 'DATABASE_URL');
  if (!base) {
    throw new Error(
      '[browser-e2e] Set SAMCO_BROWSER_E2E_DATABASE_URL, or DATABASE_URL in packages/database/.env so the ' +
        `suite can derive "${BROWSER_E2E_DATABASE}" on the same server. Aborting.`,
    );
  }
  const url = new URL(base);
  url.pathname = `/${BROWSER_E2E_DATABASE}`;
  return assertE2eDatabaseUrl(url.toString());
}

/** Same server, another database (`postgres`, `template1`) — used only to CREATE the e2e database. */
export function maintenanceUrl(url: string, database: 'postgres' | 'template1'): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function readEnvValue(file: string, key: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue;
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/**
 * Empty the suite's database. Mirrors resetDatabase() in
 * apps/api/test/utils/db.ts (append-only tables are TRUNCATEd because their
 * triggers reject DELETE; `permissions` is seeded reference data and stays).
 *
 * Guarded twice: the configured URL, then the database the connection actually
 * reached — so a misrouted client can never delete anything.
 */
export async function resetBrowserDatabase(prisma: PrismaClient, url: string): Promise<void> {
  assertE2eDatabaseUrl(url);
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`select current_database()`;
  const connected = rows[0]?.current_database ?? '';
  if (!connected.includes('e2e')) {
    throw new Error(`[browser-e2e] Connected to "${connected}", which is not an e2e database. Nothing was deleted.`);
  }

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "queue_token_events"');
  await prisma.queueToken.deleteMany();
  await prisma.queueCounter.deleteMany();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "banquet_payments"');
  await prisma.banquetEventPlan.deleteMany();
  await prisma.banquetBookingItem.deleteMany();
  await prisma.banquetBooking.deleteMany();
  await prisma.banquetHall.deleteMany();
  await prisma.banquetPackageItem.deleteMany();
  await prisma.banquetPackage.deleteMany();
  await prisma.taskChecklistItem.deleteMany();
  await prisma.task.deleteMany();
  await prisma.taskRoutine.deleteMany();
  await prisma.checklistTemplateItem.deleteMany();
  await prisma.checklistTemplate.deleteMany();
  await prisma.userBranchRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.companyMembership.deleteMany();
  await prisma.role.deleteMany();
  await prisma.displayDevice.deleteMany();
  await prisma.table.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
}

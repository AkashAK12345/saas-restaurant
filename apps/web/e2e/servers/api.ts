/**
 * Test-only launcher for the SAMCO API, started by Playwright's `webServer`.
 *
 *   1. Guard: the configured database must be an e2e database.
 *   2. Create that database if it does not exist yet (non-destructive).
 *   3. `prisma migrate deploy` + `prisma db seed` (system permissions only).
 *   4. Compile the API into apps/api/.e2e-dist (gitignored) with incremental
 *      builds off, so a browser run never touches apps/api/dist or the tracked
 *      tsconfig.build.tsbuildinfo.
 *   5. Run it on the test port against the test database, with a per-run
 *      token secret so no token from the dev API is accepted here.
 *   6. Serve a loopback-only control endpoint so a test can stop and restart
 *      the API — how the outage/reconnect acceptance is exercised for real.
 *
 * The destructive reset and the fixtures happen later, in global-setup.ts,
 * because Playwright starts web servers before it runs global setup.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { REPO_ROOT, assertE2eDatabaseUrl, databaseName, maintenanceUrl } from '../support/database';

const DATABASE_URL = assertE2eDatabaseUrl(process.env.SAMCO_E2E_DATABASE_URL);
const API_PORT = Number(process.env.SAMCO_E2E_API_PORT);
const CONTROL_PORT = Number(process.env.SAMCO_E2E_CONTROL_PORT);
const WEB_ORIGIN = process.env.SAMCO_E2E_WEB_ORIGIN ?? '';
const TOKEN_SECRET = process.env.SAMCO_E2E_ACCESS_TOKEN_SECRET ?? '';
if (!API_PORT || !CONTROL_PORT || !WEB_ORIGIN || !TOKEN_SECRET) {
  throw new Error('[browser-e2e] api launcher: start it through `playwright test`, which sets its environment.');
}

const API_DIR = path.join(REPO_ROOT, 'apps', 'api');
const DB_DIR = path.join(REPO_ROOT, 'packages', 'database');
const OUT_DIR = path.join(API_DIR, '.e2e-dist');

function runNode(script: string, args: string[], cwd: string): void {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`[browser-e2e] ${path.basename(script)} ${args.join(' ')} exited with ${result.status}`);
  }
}

/** True when the e2e database already exists (connecting to it is the whole check). */
async function databaseExists(): Promise<boolean> {
  const probe = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    await probe.$queryRaw`select 1`;
    return true;
  } catch (e) {
    if (/P1003|does not exist/i.test(String(e))) return false;
    throw e;
  } finally {
    await probe.$disconnect();
  }
}

/**
 * Create the e2e database when it is missing — from a maintenance database on
 * the same server, never from any application database.
 */
async function ensureDatabase(): Promise<void> {
  if (await databaseExists()) return;
  const name = databaseName(DATABASE_URL);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`[browser-e2e] Unexpected database name "${name}".`);
  for (const maintenance of ['postgres', 'template1'] as const) {
    const admin = new PrismaClient({ datasourceUrl: maintenanceUrl(DATABASE_URL, maintenance) });
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      return;
    } catch {
      /* no access to this maintenance database — try the next */
    } finally {
      await admin.$disconnect();
    }
  }
  throw new Error(
    `[browser-e2e] Database "${name}" does not exist and this user cannot create it from the postgres or ` +
      `template1 databases. Create it once (CREATE DATABASE ${name};) or set SAMCO_BROWSER_E2E_DATABASE_URL.`,
  );
}

let child: ChildProcess | null = null;

async function waitUntilServing(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/auth/context`);
      if (res.status < 500) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('[browser-e2e] The API did not start listening in time.');
}

async function startApi(): Promise<void> {
  if (child) return;
  child = spawn(process.execPath, [path.join(OUT_DIR, 'main.js')], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL,
      PORT: String(API_PORT),
      CORS_ORIGINS: WEB_ORIGIN,
      SCHEDULER_ENABLED: 'false',
      ACCESS_TOKEN_SECRET: TOKEN_SECRET,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  child.on('exit', () => {
    child = null;
  });
  await waitUntilServing(60_000);
}

async function stopApi(): Promise<void> {
  const running = child;
  if (!running) return;
  await new Promise<void>((resolve) => {
    running.once('exit', () => resolve());
    running.kill();
  });
}

async function main(): Promise<void> {
  await ensureDatabase();
  runNode(require.resolve('prisma/build/index.js'), ['migrate', 'deploy'], DB_DIR);
  runNode(require.resolve('prisma/build/index.js'), ['db', 'seed'], DB_DIR);

  rmSync(OUT_DIR, { recursive: true, force: true });
  runNode(
    require.resolve('typescript/bin/tsc'),
    ['-p', path.join(API_DIR, 'tsconfig.build.json'), '--outDir', OUT_DIR, '--incremental', 'false'],
    API_DIR,
  );

  await startApi();

  createServer((req, res) => {
    const act = req.method === 'POST' && req.url === '/stop' ? stopApi : req.method === 'POST' && req.url === '/start' ? startApi : null;
    if (!act) {
      res.writeHead(404).end();
      return;
    }
    act().then(
      () => res.writeHead(204).end(),
      (e: unknown) => res.writeHead(500).end(e instanceof Error ? e.message : 'failed'),
    );
  }).listen(CONTROL_PORT, '127.0.0.1');
}

function shutdown(): void {
  child?.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  child?.kill();
  process.exit(1);
});

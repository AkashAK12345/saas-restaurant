/**
 * Test-only launcher for the web app, started by Playwright's `webServer`.
 *
 * A production build (deterministic, no on-demand compiling mid-test) into its
 * own folder, `.next-e2e`, pointed at the test API — so it never collides with
 * the dev server's `.next` or Next's build lockfile — then `next start`.
 *
 * Next rewrites two tracked files for whichever folder it builds into —
 * next-env.d.ts and the `include` list in tsconfig.json — so their exact
 * previous contents are put back and a browser run leaves the working tree as
 * it found it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WEB_DIR = path.resolve(__dirname, '..', '..');
const PORT = process.env.SAMCO_E2E_WEB_PORT;
const API_ORIGIN = process.env.SAMCO_E2E_API_ORIGIN;
if (!PORT || !API_ORIGIN) {
  throw new Error('[browser-e2e] web launcher: start it through `playwright test`, which sets its environment.');
}

const nextBin = path.join(path.dirname(require.resolve('next/package.json', { paths: [WEB_DIR] })), 'dist', 'bin', 'next');
const env = {
  ...process.env,
  NEXT_DIST_DIR: '.next-e2e',
  NEXT_PUBLIC_API_URL: API_ORIGIN,
  NEXT_TELEMETRY_DISABLED: '1',
};

const generated = ['next-env.d.ts', 'tsconfig.json'].map((name) => {
  const file = path.join(WEB_DIR, name);
  return { file, before: readFileSync(file, 'utf8') };
});

const build = spawnSync(process.execPath, [nextBin, 'build'], { cwd: WEB_DIR, env, stdio: 'inherit' });
for (const { file, before } of generated) {
  if (readFileSync(file, 'utf8') !== before) writeFileSync(file, before);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, [nextBin, 'start', '--port', PORT], { cwd: WEB_DIR, env, stdio: 'inherit' });
const stop = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));

import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { browserE2eDatabaseUrl } from './e2e/support/database';

/**
 * Browser acceptance for SAMCO — `npm run test:browser` in apps/web.
 *
 * Real Chromium against a production build of the web app and the real API,
 * both started here on their own ports (3100/3101), so a running dev server is
 * never touched. Everything runs against `samco_browser_e2e`, which the suite
 * resets at the start of every run (see e2e/support/database.ts for the guard).
 *
 * SECRETS. The run's staff password and the API's token secret are generated
 * once, here in the runner process, and reach the servers, global setup and
 * the worker only through the environment. Display credentials are minted by
 * the API during global setup and travel the same way. None is printed or
 * written to a tracked file, which is why:
 *   - traces and videos are OFF — a trace records every request header
 *     (bearer tokens, `Authorization: Display …`) and every typed value;
 *   - the only reporter is `list` (no HTML report with step details);
 *   - global teardown fails the run if any secret appears in an artifact.
 */
const WEB_PORT = 3100;
const API_PORT = 3101;
const CONTROL_PORT = 3102;

process.env.SAMCO_E2E_PASSWORD ??= randomBytes(24).toString('base64url');
process.env.SAMCO_E2E_ACCESS_TOKEN_SECRET ??= randomBytes(48).toString('base64url');
process.env.SAMCO_E2E_DATABASE_URL = browserE2eDatabaseUrl();
process.env.SAMCO_E2E_WEB_PORT = String(WEB_PORT);
process.env.SAMCO_E2E_API_PORT = String(API_PORT);
process.env.SAMCO_E2E_CONTROL_PORT = String(CONTROL_PORT);
process.env.SAMCO_E2E_WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
process.env.SAMCO_E2E_API_ORIGIN = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  // One database, one set of fixtures: tests run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.SAMCO_E2E_WEB_ORIGIN,
    trace: 'off',
    video: 'off',
    // Password and credential inputs render masked in screenshots.
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx e2e/servers/api.ts',
      url: `http://127.0.0.1:${API_PORT}/api/v1/auth/context`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx tsx e2e/servers/web.ts',
      url: `http://127.0.0.1:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { SamcoApi } from './support/api';
import {
  BRANCH,
  USERS,
  loadCredentials,
  loadFixture,
  testPassword,
  webOrigin,
  type DeviceCredentials,
  type Fixture,
  type Role,
} from './support/data';

export { expect };

/**
 * How long a pushed (SSE) update may take to appear. Deliberately well under
 * the displays' 60 s safety poll (SAFETY_POLL_MS in lib/display), so an update
 * seen within it arrived by push, not by the poll.
 */
export const REALTIME_MS = 10_000;

/**
 * Recovery after a real API outage. The stream client's reconnect back-off is
 * capped at 30 s (sse-client maxBackoffMs), so the screen may legitimately wait
 * one full cap after the server is back before reconnecting.
 */
export const RECONNECT_MS = 45_000;

/** A phone: the layout-viewport behaviour that exposed the manager's 680 px nav. */
export const PHONE: BrowserContextOptions = {
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
};

type OpenPage<A extends unknown[]> = (...args: A) => Promise<Page>;

interface Fixtures {
  data: Fixture;
  credentials: DeviceCredentials;
  /** The manager, over the real API — for staff-side mutations a screen must show. */
  manager: SamcoApi;
  /** A staff member signed in through the real login form, in their own context, at Bengaluru. */
  staff: OpenPage<[role: Role, options?: BrowserContextOptions]>;
  /** A display route in its own context; paired through the real form when a credential is given. */
  display: OpenPage<
    [kind: 'queue' | 'banquet', credential?: string, branchId?: string, options?: BrowserContextOptions]
  >;
  /** Stops and restarts the test API (loopback control endpoint in e2e/servers/api.ts). */
  apiServer: { stop(): Promise<void>; start(): Promise<void> };
}

async function newContext(browser: Browser, contexts: BrowserContext[], options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ baseURL: webOrigin(), ...options });
  contexts.push(context);
  return context;
}

/** The real login form: email, this run's password, Sign in. The dashboard greets by ROLE. */
export async function signIn(page: Page, role: Role): Promise<void> {
  const user = USERS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await test.step('enter the run password', async () => {
    await page.getByLabel('Password').fill(testPassword());
  });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/');
  await expect(
    page.getByRole('heading', { level: 1, name: new RegExp(`^Good (morning|afternoon|evening),\\s*${user.roleName}$`, 'i') }),
  ).toBeVisible();
}

/** The branch pill: one company, so only a branch to choose. */
export async function chooseBranch(page: Page, branch: string): Promise<void> {
  await page.getByRole('button', { name: /^(All Branches|Select a branch)$/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Choose branch' });
  await sheet.getByRole('button', { name: new RegExp(`^${branch}\\b`) }).click();
  await expect(page.getByRole('button', { name: branch, exact: true })).toBeVisible();
}

/** The pairing form: Branch ID, credential, Pair screen. */
export async function pair(page: Page, credential: string, branchId: string): Promise<void> {
  await page.getByLabel('Branch ID').fill(branchId);
  await test.step('enter the device credential', async () => {
    await page.getByLabel('Device credential').fill(credential);
  });
  await page.getByRole('button', { name: 'Pair screen' }).click();
}

/** The visible main navigation (side bar on a desktop, bottom bar on a phone). */
export const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' });

/** Marks the current document; a reload would lose the mark. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __samcoDocument?: string }).__samcoDocument = 'same-document';
  });
}

export async function expectSameDocument(page: Page): Promise<void> {
  const mark = await page.evaluate(() => (window as unknown as { __samcoDocument?: string }).__samcoDocument);
  expect(mark, 'the update must arrive without a page reload').toBe('same-document');
}

/** No sideways page scroll, and on a phone no layout viewport wider than the screen. */
export async function expectFitsViewport(page: Page): Promise<void> {
  const size = page.viewportSize();
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(m.scroll, 'page must not scroll sideways').toBeLessThanOrEqual(m.inner);
  if (size) expect(m.inner, 'layout viewport must match the screen').toBe(size.width);
}

/** The control is inside the horizontal bounds of the screen (reachable, not clipped). */
export async function expectWithinScreen(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, 'control must be rendered').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}

export const test = base.extend<Fixtures>({
  data: async ({}, provide) => {
    await provide(loadFixture());
  },

  credentials: async ({}, provide) => {
    await provide(loadCredentials());
  },

  manager: async ({ data }, provide) => {
    const api = await SamcoApi.login(USERS.manager.email, testPassword(), data.companyA);
    await provide(api);
    await api.dispose();
  },

  staff: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (role, options) => {
      const page = await (await newContext(browser, contexts, options)).newPage();
      await signIn(page, role);
      await chooseBranch(page, BRANCH.bengaluru);
      return page;
    });
    for (const c of contexts) await c.close();
  },

  display: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (kind, credential, branchId, options) => {
      const page = await (await newContext(browser, contexts, options)).newPage();
      await page.goto(`/display/${kind}`);
      await expect(page.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
      if (credential !== undefined && branchId !== undefined) await pair(page, credential, branchId);
      return page;
    });
    for (const c of contexts) await c.close();
  },

  apiServer: async ({}, provide) => {
    const port = process.env.SAMCO_E2E_CONTROL_PORT;
    const control = async (action: 'stop' | 'start') => {
      const res = await fetch(`http://127.0.0.1:${port}/${action}`, { method: 'POST' });
      if (res.status !== 204) throw new Error(`[browser-e2e] API ${action} failed (${res.status}).`);
    };
    let stopped = false;
    await provide({
      stop: async () => {
        await control('stop');
        stopped = true;
      },
      start: async () => {
        await control('start');
        stopped = false;
      },
    });
    // Never leave the rest of the run without an API.
    if (stopped) await control('start');
  },
});

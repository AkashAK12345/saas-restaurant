import {
  PHONE,
  REALTIME_MS,
  RECONNECT_MS,
  expect,
  expectFitsViewport,
  expectSameDocument,
  markDocument,
  mainNav,
  pair,
  test,
} from './fixtures';
import { BOOKING, BRANCH, HALL, PACKAGE } from './support/data';
import type { Page } from '@playwright/test';

/**
 * Display-device acceptance: the three paired screens, their projections,
 * live updates, an outage, and every way a screen must be refused.
 *
 * Each screen gets its own browser context, so there is no shared pairing
 * slot between screens (the manual browser pane had one).
 */

/** Customer identity from the fixture — never on any screen. */
const CUSTOMER_IDENTITY = /Priya|Sharma|Arun|Menon|\+91/;
/** Money — never on the kitchen screen. */
const MONEY = /₹|INR|\bpaid\b|balance|850/i;

async function expectDisplayShellOnly(page: Page): Promise<void> {
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Sign out')).toHaveCount(0);
}

/**
 * The pairing form's own error. Scoped to the form: Next also renders an empty
 * route announcer with role="alert" on every page.
 */
const pairingAlert = (page: Page) => page.locator('form').getByRole('alert');

function kitchenCounts(text: string): { pending: number; cooking: number; ready: number } {
  const m = text.match(/(\d+)\s+pending\s+·\s+(\d+)\s+cooking\s+·\s+(\d+)\s+ready/);
  if (!m) throw new Error(`no kitchen counts in: ${text}`);
  return { pending: Number(m[1]), cooking: Number(m[2]), ready: Number(m[3]) };
}

test.describe('Queue customer display (QUEUE_CUSTOMER)', () => {
  test('pairs and shows only the public board of its own branch, and stays paired on reload', async ({
    display,
    credentials,
    data,
    manager,
  }) => {
    const bengaluru = await manager.board(data.branches.bengaluru);
    const pallavaram = await manager.board(data.branches.pallavaram);
    expect(pallavaram.waiting.length).not.toBe(bengaluru.waiting.length);

    const page = await display('queue', credentials.customer, data.branches.bengaluru);
    await expect(page.getByRole('heading', { name: 'Now serving' })).toBeVisible();
    await expect(page.getByText(BRANCH.bengaluru, { exact: true })).toBeVisible();
    await expect(page.getByText('Live')).toBeVisible();
    await expect(page.locator('footer')).toContainText(`${bengaluru.waiting.length} waiting`);

    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(CUSTOMER_IDENTITY);
    expect(text, 'party sizes are operational detail, not for the dining room').not.toMatch(/guests|adults|kids/i);
    await expectDisplayShellOnly(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Now serving' })).toBeVisible();
    await expect(page.getByLabel('Device credential')).toHaveCount(0);
    await expect(page.getByText('Live')).toBeVisible();
  });

  test('shows a called party and then its table, live, without a reload', async ({
    display,
    credentials,
    data,
    manager,
  }) => {
    const branch = data.branches.bengaluru;
    const token = await manager.register(branch, { adults: 2 });
    const page = await display('queue', credentials.customer, branch);
    await expect(page.getByText('Live')).toBeVisible();
    await markDocument(page);

    await manager.call(branch, token.id);
    const serving = page.getByText('Please come to the podium').locator('..');
    await expect(serving).toContainText(String(token.token_number), { timeout: REALTIME_MS });

    await manager.seat(branch, token.id, data.tables.T2);
    await expect(page.getByRole('list', { name: 'Recently seated' })).toContainText(
      `${token.token_number} · T2`,
      { timeout: REALTIME_MS },
    );
    await expectSameDocument(page);
  });

  test('says it is reconnecting during an API outage, keeps its board, and recovers', async ({
    display,
    credentials,
    data,
    manager,
    apiServer,
  }) => {
    const branch = data.branches.bengaluru;
    const page = await display('queue', credentials.customer, branch);
    await expect(page.getByText('Live')).toBeVisible();
    await markDocument(page);

    await apiServer.stop();
    try {
      await expect(page.getByText('Reconnecting…')).toBeVisible({ timeout: REALTIME_MS });
      await expect(page.getByRole('heading', { name: 'Now serving' })).toBeVisible();
      await expect(page.getByLabel('Device credential'), 'an outage is not a refused credential').toHaveCount(0);
    } finally {
      await apiServer.start();
    }

    await expect(page.getByText('Live')).toBeVisible({ timeout: RECONNECT_MS });
    const token = await manager.register(branch, { adults: 3 });
    await manager.call(branch, token.id);
    await expect(page.getByText('Please come to the podium').locator('..')).toContainText(
      String(token.token_number),
      { timeout: REALTIME_MS },
    );
    await expectSameDocument(page);
  });
});

test.describe('Queue admin display (QUEUE_ADMIN)', () => {
  test('pairs and shows the operational projection without customer identity', async ({
    display,
    credentials,
    data,
  }) => {
    const page = await display('queue', credentials.admin, data.branches.bengaluru);
    await expect(page.getByRole('heading', { name: 'Queue overview' })).toBeVisible();
    await expect(page.getByText(`${BRANCH.bengaluru} · ${data.serviceDate}`)).toBeVisible();
    for (const column of ['Waiting', 'Called', 'Seated']) {
      await expect(page.getByText(column, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Live')).toBeVisible();

    const text = await page.locator('body').innerText();
    expect(text, 'the admin projection carries party sizes').toMatch(/\d+ guests?/);
    expect(text).not.toMatch(CUSTOMER_IDENTITY);
    await expectDisplayShellOnly(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Queue overview' })).toBeVisible();
  });

  test('moves a party through Called and Seated live, without a reload', async ({
    display,
    credentials,
    data,
    manager,
  }) => {
    const branch = data.branches.bengaluru;
    const token = await manager.register(branch, { adults: 5 });
    const page = await display('queue', credentials.admin, branch);
    await expect(page.getByText('Live')).toBeVisible();
    await markDocument(page);

    const column = (title: string) =>
      page.locator('section').filter({ has: page.getByText(title, { exact: true }) });
    await expect(column('Waiting')).toContainText('5 guests');

    await manager.call(branch, token.id);
    await expect(column('Called')).toContainText(String(token.token_number), { timeout: REALTIME_MS });

    await manager.seat(branch, token.id, data.tables.T3);
    await expect(column('Seated')).toContainText('Table T3', { timeout: REALTIME_MS });
    await expectSameDocument(page);
  });
});

test.describe('Banquet kitchen display (BANQUET_CHEF)', () => {
  test('pairs and shows dishes and covers, with no customer and no money', async ({
    display,
    credentials,
    data,
  }) => {
    const page = await display('banquet', credentials.chef, data.branches.bengaluru);
    await expect(page.getByRole('heading', { name: 'Kitchen' })).toBeVisible();
    await expect(page.getByText(`${BRANCH.bengaluru} · ${data.serviceDate}`)).toBeVisible();

    const event = page.getByRole('region', { name: `Event in ${HALL.name}` });
    await expect(event).toContainText(`${BOOKING.guests} covers`);
    await expect(event).toContainText(BOOKING.kitchenNotes);
    for (const dish of PACKAGE.dishes) await expect(event).toContainText(dish);
    await expect(page.getByText('Live')).toBeVisible();

    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(CUSTOMER_IDENTITY);
    expect(text).not.toMatch(MONEY);
    await expectDisplayShellOnly(page);
  });

  test('shows the chef’s Start and Ready live, with the counts', async ({ display, staff, credentials, data }) => {
    const board = await display('banquet', credentials.chef, data.branches.bengaluru);
    await expect(board.getByText('Live')).toBeVisible();
    await markDocument(board);
    const before = kitchenCounts(await board.locator('footer').innerText());

    const kitchen = await staff('chef');
    await kitchen.goto('/banquet/kds');
    const dish = PACKAGE.dishes[0];
    const staffRow = kitchen.getByRole('listitem').filter({ hasText: dish });
    const boardRow = board.getByRole('listitem').filter({ hasText: dish });
    await expect(boardRow).toContainText('Pending');

    await staffRow.getByRole('button', { name: 'Start' }).click();
    await expect(boardRow).toContainText('Cooking', { timeout: REALTIME_MS });
    await expect(board.locator('footer')).toContainText(
      `${before.pending - 1} pending · ${before.cooking + 1} cooking · ${before.ready} ready`,
      { timeout: REALTIME_MS },
    );

    await staffRow.getByRole('button', { name: 'Ready' }).click();
    await expect(boardRow).toContainText('Ready', { timeout: REALTIME_MS });
    await expect(board.locator('footer')).toContainText(
      `${before.pending - 1} pending · ${before.cooking} cooking · ${before.ready + 1} ready`,
      { timeout: REALTIME_MS },
    );
    await expectSameDocument(board);
  });
});

test.describe('Display security', () => {
  test('a genuine credential of the wrong kind is refused', async ({ display, credentials, data }) => {
    const page = await display('banquet', credentials.customer, data.branches.bengaluru);
    await expect(pairingAlert(page)).toHaveText('This screen is not allowed to show this board');
    await expect(page.getByRole('heading', { name: 'Kitchen' })).toHaveCount(0);
  });

  test('a credential is refused for another branch of the same company', async ({ display, credentials, data }) => {
    const page = await display('queue', credentials.customer, data.branches.pallavaram);
    await expect(pairingAlert(page)).toHaveText('This screen is not paired');
    await expect(page.getByRole('heading', { name: 'Now serving' })).toHaveCount(0);
  });

  test('a credential is refused for another company’s branch', async ({ display, credentials, data }) => {
    const page = await display('queue', credentials.customer, data.branches.chennai);
    await expect(pairingAlert(page)).toHaveText('This screen is not paired');
    await expect(page.getByRole('heading', { name: 'Now serving' })).toHaveCount(0);
  });

  test('empty, malformed and branchless entries are refused before any request', async ({
    display,
    credentials,
    data,
  }) => {
    const page = await display('queue');
    const displayRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/display/')) displayRequests.push(r.url());
    });

    await pair(page, '', data.branches.bengaluru);
    await expect(pairingAlert(page)).toHaveText('That does not look like a device credential.');
    await pair(page, 'abc', data.branches.bengaluru);
    await expect(pairingAlert(page)).toHaveText('That does not look like a device credential.');
    await pair(page, credentials.customer, '');
    await expect(pairingAlert(page)).toHaveText('Enter the branch this screen belongs to.');

    expect(displayRequests, 'nothing reaches the API').toHaveLength(0);
  });

  test('a revoked credential cannot pair', async ({ display, credentials, data }) => {
    const page = await display('queue', credentials.revoked, data.branches.bengaluru);
    await expect(pairingAlert(page)).toHaveText('This screen is not paired');
    await expect(page.getByRole('heading', { name: 'Now serving' })).toHaveCount(0);
  });

  test('revoking a device stops its open screen, and its credential cannot pair again', async ({
    display,
    data,
    manager,
  }) => {
    const branch = data.branches.bengaluru;
    const device = await manager.createDevice(branch, 'QUEUE_CUSTOMER', 'E2E revoked while open');
    const page = await display('queue', device.credential, branch);
    await expect(page.getByText('Live')).toBeVisible();

    await manager.revokeDevice(branch, device.id);
    // Revocation is not pushed: the screen learns at its next board fetch. A
    // queue event causes one, well before the 60 s safety poll.
    await manager.register(branch, { adults: 1 });
    await expect(pairingAlert(page)).toHaveText('This screen is not paired', { timeout: REALTIME_MS });
    await expect(page.getByRole('heading', { name: 'Now serving' })).toHaveCount(0);

    await pair(page, device.credential, branch);
    await expect(pairingAlert(page)).toHaveText('This screen is not paired');
    await expect(page.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
  });

  test('a paired screen cannot reach the staff application', async ({ display, credentials, data }) => {
    const page = await display('queue', credentials.customer, data.branches.bengaluru);
    await expect(page.getByRole('heading', { name: 'Now serving' })).toBeVisible();

    for (const path of ['/', '/queue', '/queue/podium', '/banquet/kitchen', '/tasks']) {
      await page.goto(path);
      // Sign-in now carries the page asked for as `next` (validated on return),
      // so a signed-out deep link lands where it pointed. The screen still gets
      // no staff shell.
      await expect(page, `${path} must send a display to sign-in`).toHaveURL(/\/login(\?next=[^&]*)?$/);
      await expect(mainNav(page)).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.sessionStorage.getItem('samco.refresh'))).toBeNull();
  });
});

test.describe('Display screens on a phone-sized screen', () => {
  test('the queue and kitchen screens fit without sideways scrolling', async ({ display, credentials, data }) => {
    const queue = await display('queue', credentials.customer, data.branches.bengaluru, PHONE);
    await expect(queue.getByRole('heading', { name: 'Now serving' })).toBeVisible();
    await expect(queue.getByText('Live')).toBeInViewport();
    await expectFitsViewport(queue);

    const kitchen = await display('banquet', credentials.chef, data.branches.bengaluru, PHONE);
    await expect(kitchen.getByRole('heading', { name: 'Kitchen' })).toBeVisible();
    await expectFitsViewport(kitchen);
  });
});

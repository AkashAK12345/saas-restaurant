import type { BrowserContextOptions, Page } from '@playwright/test';
import { PHONE, expect, expectFitsViewport, mainNav, test } from './fixtures';
import { SamcoApi } from './support/api';
import { BRANCH, CUSTOMERS, USERS, testPassword } from './support/data';

/**
 * Browser acceptance for the administration screens that replaced the
 * "not available in this version" placeholders: customers, tables, display
 * screens, users and roles. Each control is exercised against the real API,
 * and each screen is refused, with no data, to someone without the permission.
 */

const TABLET: BrowserContextOptions = { viewport: { width: 768, height: 1024 }, hasTouch: true };

async function gotoMain(page: Page, path: string) {
  await page.goto(path);
  return page.getByRole('main');
}

test.describe('Administration — customers and tables', () => {
  test('customers: search by name, open the details, and add one', async ({ staff }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, '/customers');
    await expect(main.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();

    await main.getByLabel('Search name or phone').fill('priya');
    await main.getByRole('button', { name: 'Search' }).click();
    const table = main.getByRole('table', { name: 'Customers' });
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('••••0001');
    await expect(table).not.toContainText('+919800000001');

    await table.getByRole('button', { name: CUSTOMERS.priya }).click();
    const details = main.getByRole('complementary', { name: 'Customer details' });
    await expect(details).toContainText('+919800000001');

    await main.getByRole('button', { name: 'Add customer' }).click();
    await details.getByLabel('Name').fill('Leela Menon');
    await details.getByLabel('Phone (optional)').fill('+91 98000 00077');
    await details.getByRole('button', { name: 'Add' }).click();
    await expect(main.getByText('Added Leela Menon.')).toBeVisible();
    await expect(details).toContainText('+919800000077');
  });

  test('customers fit a phone', async ({ staff }) => {
    const page = await staff('manager', PHONE);
    const main = await gotoMain(page, '/customers');
    await expect(main.getByRole('table', { name: 'Customers' })).toBeVisible();
    await expectFitsViewport(page);
  });

  test('tables: add one, take it out of service and back, on a tablet', async ({ staff }) => {
    const page = await staff('manager', TABLET);
    const main = await gotoMain(page, '/tables');
    await expect(main.getByRole('heading', { level: 1, name: 'Tables' })).toBeVisible();
    await expectFitsViewport(page);

    await main.getByRole('button', { name: 'Add table' }).click();
    await main.getByLabel('Label').fill('T9');
    await main.getByLabel('Seats').fill('6');
    await main.getByLabel('Zone (optional)').fill('Patio');
    await main.getByRole('button', { name: 'Add table' }).click();
    await expect(main.getByText('Added table T9.')).toBeVisible();

    const list = main.getByRole('list', { name: 'Tables' });
    const t9 = list.getByRole('listitem').filter({ hasText: 'T9' });
    await expect(t9).toContainText('6 seats · Patio');
    await t9.getByRole('button', { name: 'Take out of service table T9' }).click();
    await expect(t9).toContainText('Out of service');
    await t9.getByRole('button', { name: 'Return to service table T9' }).click();
    await expect(t9).toContainText('In service');
  });
});

test.describe('Administration — display screens', () => {
  test('pairing shows the code once; a revoked screen’s code can never pair', async ({ staff, display, data }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, '/displays');
    await expect(main.getByRole('heading', { level: 1, name: 'Displays' })).toBeVisible();

    await main.getByRole('button', { name: 'Pair a screen' }).click();
    await main.getByLabel('Screen name').fill('Lobby screen');
    await main.getByLabel('Kind').selectOption({ label: 'Queue — customer screen' });
    await main.getByRole('button', { name: 'Pair screen' }).click();

    const region = main.getByRole('region', { name: 'Pairing code' });
    await expect(region).toContainText('/display/queue');
    const code = (await region.getByLabel('One-time pairing code').innerText()).trim();
    expect(code).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    await region.getByRole('button', { name: 'Done — hide the code' }).click();
    await expect(main.getByRole('region', { name: 'Pairing code' })).toHaveCount(0);
    await expect(main).not.toContainText(code);

    // Reloading never brings the code back.
    await page.reload();
    await expect(page.getByRole('main')).not.toContainText(code.split('.')[1]);

    const card = page.getByRole('main').getByRole('list', { name: 'Display screens' }).getByRole('listitem').filter({ hasText: 'Lobby screen' });
    await card.getByRole('button', { name: 'Revoke Lobby screen' }).click();
    await card.getByRole('group', { name: 'Confirm revoking Lobby screen' }).getByRole('button', { name: 'Yes, revoke' }).click();
    await expect(card).toContainText('Revoked');

    const screen = await display('queue', code, data.branches.bengaluru);
    await expect(screen.getByRole('alert').first()).toHaveText('This screen is not paired');
  });
});

test.describe('Administration — users and roles', () => {
  test('adds a user, gives and removes a role at this branch, and disables sign-in', async ({ staff, data }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, '/settings/users');
    await expect(main.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();

    await main.getByRole('button', { name: 'Add user' }).click();
    const panel = main.getByRole('complementary', { name: 'User details' });
    await panel.getByLabel('Email').fill('nora.hire@samco.test');
    await panel.getByLabel('First name').fill('Nora');
    await test.step('enter the run password as the initial password', async () => {
      await panel.getByLabel('Initial password').fill(testPassword());
    });
    await panel.getByRole('button', { name: 'Add' }).click();
    await expect(main.getByText(/Added nora\.hire@samco\.test/)).toBeVisible();

    await main.getByRole('table', { name: 'Users' }).getByRole('button', { name: 'Nora' }).click();
    await expect(panel.getByText(/No roles at any branch/)).toBeVisible();
    await panel.getByLabel(`Assign a role at ${BRANCH.bengaluru}`).selectOption({ label: USERS.worker.roleName });
    await panel.getByRole('button', { name: 'Assign' }).click();
    const chips = panel.getByRole('list', { name: 'Role assignments' });
    await expect(chips).toContainText(`${USERS.worker.roleName} · ${BRANCH.bengaluru}`);

    // Nora can now sign in and act at Bengaluru.
    const nora = await SamcoApi.login('nora.hire@samco.test', testPassword(), data.companyA);
    try {
      await expect(nora.send('GET', 'tasks?limit=1', data.branches.bengaluru)).resolves.toBeTruthy();
    } finally {
      await nora.dispose();
    }

    await chips.getByRole('button', { name: `Remove ${USERS.worker.roleName} at ${BRANCH.bengaluru}` }).click();
    await expect(panel.getByText(/No roles at any branch/)).toBeVisible();

    await panel.getByRole('button', { name: 'Disable sign-in' }).click();
    await expect(main.getByText(/Nora can no longer sign in/)).toBeVisible();
    await expect(SamcoApi.login('nora.hire@samco.test', testPassword(), data.companyA)).rejects.toThrow(/401/);
  });

  test('the manager never sees controls over their own access', async ({ staff }) => {
    const page = await staff('manager', PHONE);
    const main = await gotoMain(page, '/settings/users');
    await main.getByRole('table', { name: 'Users' }).getByRole('button', { name: `${USERS.manager.firstName} ${USERS.manager.lastName}` }).click();
    const panel = main.getByRole('complementary', { name: 'User details' });
    await expect(panel.getByText(/This is you/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Disable sign-in' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Remove from company' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Remove .* at / })).toHaveCount(0);
    await expectFitsViewport(page);
  });

  test('creates a role and grants it a permission from the catalogue', async ({ staff }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, '/settings/roles');
    await expect(main.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();

    await main.getByRole('button', { name: 'Add role' }).click();
    const panel = main.getByRole('complementary', { name: 'Role details' });
    await panel.getByLabel('Name').fill('Host');
    await panel.getByRole('button', { name: 'Add' }).click();
    await expect(main.getByText('Added role Host.')).toBeVisible();

    const list = main.getByRole('list', { name: 'Roles' });
    await list.getByRole('button', { name: 'Host', exact: true }).click();
    await panel.getByRole('button', { name: 'Edit permissions' }).click();
    await panel.getByRole('checkbox', { name: /\(queue\.view\)/ }).check();
    await panel.getByRole('button', { name: 'Save permissions' }).click();
    await expect(main.getByText('Saved permissions for Host.')).toBeVisible();
    await expect(list.getByRole('listitem').filter({ hasText: 'Host' })).toContainText('1 permission');
  });
});

test.describe('Administration — refused without permission', () => {
  const SCREENS: Array<[string, RegExp]> = [
    ['/customers', /do not have access to customers/],
    ['/tables', /do not have access to tables/],
    ['/displays', /do not have access to display screens/],
    ['/settings/users', /do not have access to users/],
    ['/settings/roles', /do not have access to roles/],
  ];

  test('a worker opening each screen directly gets a refusal, no data and no controls', async ({ staff }) => {
    const page = await staff('worker');
    await expect(mainNav(page).getByRole('link', { name: 'Customers' })).toHaveCount(0);
    for (const [path, refusal] of SCREENS) {
      const main = await gotoMain(page, path);
      await expect(main.getByText(refusal), path).toBeVisible();
      const text = await main.innerText();
      expect(text, path).not.toContain(CUSTOMERS.priya);
      expect(text, path).not.toContain(USERS.manager.email);
      for (const name of ['Add customer', 'Add table', 'Pair a screen', 'Add user', 'Add role']) {
        await expect(main.getByRole('button', { name }), `${path} offers "${name}"`).toHaveCount(0);
      }
    }
  });
});

import type { BrowserContextOptions, Page } from '@playwright/test';
import { PHONE, expect, expectFitsViewport, test } from './fixtures';
import { PACKAGE, branchToday } from './support/data';

/**
 * Browser acceptance for the operational gaps closed in this pass: the waiter's
 * floor view, plate approval between two people, dashboard custom periods with
 * the daily queue chart and the branch matrix, per-record history, and branch
 * bill terms. Every step waits for what the server confirmed.
 */

const TABLET: BrowserContextOptions = { viewport: { width: 768, height: 1024 }, hasTouch: true };

async function gotoMain(page: Page, path: string) {
  await page.goto(path);
  return page.getByRole('main');
}

test.describe('Queue — the waiter floor view', () => {
  test('seats a called party at a free table and clears it, on a tablet', async ({ staff, manager, data }) => {
    const branch = data.branches.bengaluru;
    // Its own party, so the shared fixture's waiting list is left as it was.
    const party = await manager.register(branch, { adults: 2 });
    await manager.call(branch, party.id);

    const page = await staff('manager', TABLET);
    const main = await gotoMain(page, '/queue/tables');
    await expect(main.getByRole('heading', { level: 1, name: 'Tables' })).toBeVisible();
    await expectFitsViewport(page);

    const t1 = main.getByRole('listitem', { name: 'Table T1' });
    await expect(t1).toContainText('Free');
    await t1.getByLabel('Party for table T1').selectOption({ label: `Token ${party.token_number} · 2 guests` });
    await t1.getByRole('button', { name: 'Seat here' }).click();
    await expect(t1).toContainText('Occupied');
    await expect(t1).toContainText(`Token ${party.token_number}`);

    const seated = (await manager.board(branch)).seated.find((t) => t.id === party.id) as unknown as { assigned_table_id: string };
    expect(seated.assigned_table_id).toBe(data.tables.T1);

    await t1.getByRole('button', { name: 'Table cleared' }).click();
    await expect(t1).toContainText('Free');
    const after = (await manager.board(branch)).seated.find((t) => t.id === party.id) as unknown as { assigned_table_id: string | null };
    expect(after.assigned_table_id).toBeNull();
  });
});

test.describe('Banquet — plate approval', () => {
  test('the manager asks, the chef approves and dispatches, and the manager sees the answer', async ({ staff, data }) => {
    const dish = PACKAGE.dishes[0];
    const managerPage = await staff('manager');
    let main = await gotoMain(managerPage, `/banquet/${data.bookingId}`);
    await expect(main.getByRole('heading', { name: 'Plates' })).toBeVisible();
    await main.getByLabel('Dish').selectOption({ label: dish });
    await main.getByLabel('Plates', { exact: true }).fill('20');
    await main.getByLabel('Note for the kitchen (optional)').fill('Head table');
    await main.getByRole('button', { name: 'Request plates' }).click();
    await expect(main.getByText('Plate request sent to the kitchen.')).toBeVisible();
    const mine = main.getByRole('list', { name: 'Plate requests for this booking' });
    await expect(mine).toContainText(`20 × ${dish}`);
    await expect(mine).toContainText('Waiting for the kitchen');

    // The manager holds kitchen rights too, but may not decide their own request.
    main = await gotoMain(managerPage, '/banquet/kitchen');
    const ownList = main.getByRole('list', { name: 'Open plate requests' });
    await expect(ownList).toContainText(`20 × ${dish}`);
    await expect(ownList.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
    await expect(ownList).toContainText('another cook decides');

    const chefPage = await staff('chef');
    const kitchen = await gotoMain(chefPage, '/banquet/kitchen');
    const open = kitchen.getByRole('list', { name: 'Open plate requests' });
    await open.getByRole('button', { name: `Approve 20 plates of ${dish}` }).click();
    await expect(open).toContainText('Approved');
    await open.getByRole('button', { name: `Dispatch 20 plates of ${dish}` }).click();
    await expect(kitchen.getByText('Done today (1)')).toBeVisible();

    main = await gotoMain(managerPage, `/banquet/${data.bookingId}`);
    await expect(main.getByRole('list', { name: 'Plate requests for this booking' })).toContainText('Dispatched');
  });
});

test.describe('Dashboard — periods, the daily queue chart and the branch matrix', () => {
  test('a custom period draws the daily queue chart on a phone without sideways scroll', async ({ staff }) => {
    const page = await staff('manager', PHONE);
    const main = page.getByRole('main');
    const period = main.getByRole('group', { name: 'Dashboard period' });
    await period.getByRole('button', { name: 'Custom' }).click();

    const today = branchToday();
    const form = main.getByRole('form', { name: 'Custom period' });
    await form.getByLabel('From').fill(`${today.slice(0, 8)}01`);
    await form.getByLabel('To').fill(today);
    await form.getByRole('button', { name: 'Apply' }).click();

    const chart = main.getByRole('img', { name: /Daily queue: Walked in/ });
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('aria-label', /highest \d+ on/);
    await main.getByLabel('Figure').first().selectOption({ label: 'Seated' });
    await expect(main.getByRole('img', { name: /Daily queue: Seated/ })).toBeVisible();
    await expectFitsViewport(page);
  });

  test('All branches compares the queue overview across branches', async ({ staff }) => {
    const page = await staff('manager');
    const main = page.getByRole('main');
    await main.getByRole('group', { name: 'Dashboard period' }).getByRole('button', { name: 'All branches' }).click();
    const matrix = main.getByRole('table', { name: 'Queue overview by branch' });
    await expect(matrix.getByRole('columnheader')).toHaveText(['Figure', 'All branches', 'Bengaluru', 'Pallavaram']);
    await expect(matrix.getByRole('row', { name: /Total walked in/ })).toBeVisible();
  });
});

test.describe('Records — history and bill terms', () => {
  test('a booking’s history shows who changed it', async ({ staff, data }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, `/banquet/${data.bookingId}`);
    await main.getByText('History', { exact: true }).click();
    const history = main.getByRole('list', { name: 'Change history' });
    await expect(history).toContainText('confirm');
    await expect(history).toContainText('Meera Nair');
  });

  test('branch bill terms reach the printed bill', async ({ staff, manager, data }) => {
    const page = await staff('manager');
    let main = await gotoMain(page, '/settings/branches');
    await main.getByRole('button', { name: 'Edit tax details for Bengaluru' }).click();
    await main.getByLabel('Terms and conditions on banquet bills').fill('Advance is non-refundable.\nMusic stops at 23:00.');
    await main.getByRole('button', { name: 'Save' }).click();
    await expect(main.getByText(/Saved Bengaluru/)).toBeVisible();

    main = await gotoMain(page, `/banquet/${data.bookingId}/bill`);
    const terms = main.getByRole('region', { name: 'Terms and conditions' });
    await expect(terms).toContainText('Advance is non-refundable.');
    await expect(terms).toContainText('Music stops at 23:00.');

    await manager.send('PATCH', `branches/${data.branches.bengaluru}`, null, { banquet_terms: null });
  });
});

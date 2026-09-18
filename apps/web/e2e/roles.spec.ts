import type { Page } from '@playwright/test';
import { PHONE, expect, expectFitsViewport, expectWithinScreen, mainNav, test } from './fixtures';
import { CHECKLIST, CUSTOMERS, HALL, PACKAGE, ROUTINE, TASK_TITLE } from './support/data';

/**
 * Role-based acceptance for the three restricted staff roles, each signed in
 * through the real login form in its own browser context.
 */

/** Fixture data a refused page must never render. */
const PROTECTED_DATA = [CUSTOMERS.priya, CUSTOMERS.arun, TASK_TITLE, CHECKLIST.name, HALL.name, ROUTINE.name, ...PACKAGE.dishes];

/** Empty states — on a refused page these would claim there is nothing, which is untrue. */
const FALSE_EMPTY_STATES = [
  'Nobody is waiting',
  'No party has been called',
  'Nobody has been seated yet',
  'Nothing here',
  'No bookings yet',
  'No halls yet',
  'No packages yet',
  'No routines yet',
  'No checklists yet',
  'No confirmed events for this day',
  'No data for this period',
];

/** Controls that would change data; none may be offered on a refused page. */
const MUTATION_CONTROLS = [
  'Call',
  'Seat',
  'Seat at table',
  'No show',
  'Cancel',
  'Add to queue',
  'New booking',
  'Create draft',
  'Start',
  'Ready',
  'Complete',
  'New task',
  'Create task',
  'New routine',
  'Generate due tasks now',
  'Create checklist',
  'Record payment',
  'Export Excel',
  'Export PDF',
];

async function expectRefused(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const main = page.getByRole('main');
  await expect(main.getByRole('alert').first(), `${path} must say it was refused`).toContainText(
    /Forbidden|not allowed|permission/i,
  );
  const wayOut = page.getByRole('link', { name: 'Home', exact: true }).or(mainNav(page));
  await expect(wayOut.first(), `${path} must leave a way out of the refusal`).toBeVisible();

  const text = await main.innerText();
  for (const item of PROTECTED_DATA) expect(text, `${path} must not show "${item}"`).not.toContain(item);
  for (const claim of FALSE_EMPTY_STATES) expect(text, `${path} must not claim "${claim}"`).not.toContain(claim);
  for (const name of MUTATION_CONTROLS) {
    await expect(main.getByRole('button', { name, exact: true }), `${path} must not offer "${name}"`).toHaveCount(0);
  }
}

test.describe('Chef', () => {
  test('sees only Home and Banquet, and Banquet opens the kitchen', async ({ staff }) => {
    const page = await staff('chef');
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Banquet', 'Settings']);

    await mainNav(page).getByRole('link', { name: 'Banquet' }).click();
    await expect(page).toHaveURL(/\/banquet\/kitchen$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Banquet sections' }).getByRole('link')).toHaveText(['Home', 'Chef', 'KDS']);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    // The banquet frame carries its own way home, and the dashboard card
    // lands in the same place.
    await page.getByRole('navigation', { name: 'Banquet sections' }).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL((u) => u.pathname === '/');
    await page.getByRole('main').getByRole('link', { name: /Banquet/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen' })).toBeVisible();
  });

  test('starts and readies a dish in the kitchen, and the counts follow', async ({ staff }) => {
    const page = await staff('chef');
    await mainNav(page).getByRole('link', { name: 'Banquet' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen' })).toBeVisible();

    const counts = async () => {
      const text = await page.getByText(/\d+ pending · \d+ cooking · \d+ ready/).innerText();
      const m = text.match(/(\d+) pending · (\d+) cooking · (\d+) ready/)!;
      return { pending: Number(m[1]), cooking: Number(m[2]), ready: Number(m[3]) };
    };
    const before = await counts();
    const row = page.getByRole('listitem').filter({ hasText: PACKAGE.dishes[1] });
    await expect(row).toContainText('Pending');

    await row.getByRole('button', { name: 'Start' }).click();
    await expect(row).toContainText('Cooking');
    await expect(page.getByText(`${before.pending - 1} pending · ${before.cooking + 1} cooking`)).toBeVisible();

    await row.getByRole('button', { name: 'Ready' }).click();
    await expect(row).toContainText('Ready');
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(
      page.getByText(`${before.pending - 1} pending · ${before.cooking} cooking · ${before.ready + 1} ready`),
    ).toBeVisible();
  });

  test('is refused everywhere else, with no data and no false empty state', async ({ staff }) => {
    const page = await staff('chef');
    for (const path of ['/queue', '/tasks', '/reports', '/banquet/catalog']) await expectRefused(page, path);
  });

  test('works on a phone', async ({ staff }) => {
    const page = await staff('chef', PHONE);
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Banquet', 'Settings']);
    await mainNav(page).getByRole('link', { name: 'Banquet' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen' })).toBeVisible();
    await expectFitsViewport(page);
    const row = page.getByRole('listitem').filter({ hasText: PACKAGE.dishes[2] });
    await expectWithinScreen(page, row.getByRole('button', { name: 'Start' }));
  });
});

test.describe('Worker', () => {
  test('sees only Home and Tasks, and the task board without staff-only controls', async ({ staff }) => {
    const page = await staff('worker');
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Tasks', 'Settings']);

    await mainNav(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Task sections' }).getByRole('link')).toHaveText([
      'Board',
      'Routines',
      'Checklists',
    ]);
    await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);

    const card = page.getByRole('listitem').filter({ hasText: TASK_TITLE });
    await expect(card.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Complete' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  });

  test('starts a task, ticks its required checklist items and completes it', async ({ staff, manager, data }) => {
    const page = await staff('worker');
    await mainNav(page).getByRole('link', { name: 'Tasks' }).click();

    const card = page.getByRole('listitem').filter({ hasText: TASK_TITLE });
    const href = await card.getByRole('link', { name: TASK_TITLE }).getAttribute('href');
    expect(href).toBeTruthy();
    await card.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText(`Started “${TASK_TITLE}”.`)).toBeVisible();

    await page.goto(href!);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: TASK_TITLE })).toBeVisible();
    await expect(main.getByText('In progress')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Complete' })).toBeDisabled();
    await expect(main.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Clear assignment' })).toHaveCount(0);

    // Each box follows the server: a tick is shown once the API has saved it.
    for (const item of CHECKLIST.items.filter((i) => i.is_required)) {
      await main.getByLabel(item.label).click();
      await expect(main.getByLabel(item.label)).toBeChecked();
    }
    await expect(main.getByRole('button', { name: 'Complete' })).toBeEnabled();
    await main.getByRole('button', { name: 'Complete' }).click();
    await expect(main.getByText('Task completed.')).toBeVisible();
    await expect(main.getByText('Completed', { exact: true }).first()).toBeVisible();
    for (const item of CHECKLIST.items) await expect(main.getByLabel(item.label)).toBeDisabled();

    const saved = await manager.send<{ status: string }>('GET', `tasks/${data.taskId}`, data.branches.bengaluru);
    expect(saved.status).toBe('COMPLETED');
  });

  test('can read routines and checklists but not manage them', async ({ staff }) => {
    const page = await staff('worker');
    await mainNav(page).getByRole('link', { name: 'Tasks' }).click();
    const sections = page.getByRole('navigation', { name: 'Task sections' });

    await sections.getByRole('link', { name: 'Routines' }).click();
    const main = page.getByRole('main');
    await expect(main.getByText(ROUTINE.name)).toBeVisible();
    for (const control of ['New routine', 'Generate due tasks now', 'Pause', 'Resume']) {
      await expect(main.getByRole('button', { name: control })).toHaveCount(0);
    }

    await sections.getByRole('link', { name: 'Checklists' }).click();
    await expect(main.getByText(CHECKLIST.name)).toBeVisible();
    for (const control of ['Create checklist', 'Retire', 'Restore']) {
      await expect(main.getByRole('button', { name: control })).toHaveCount(0);
    }
    await expect(main.getByLabel('Checklist name')).toHaveCount(0);
  });

  test('is refused everywhere else, with no data and no false empty state', async ({ staff }) => {
    const page = await staff('worker');
    for (const path of ['/queue', '/banquet', '/reports']) await expectRefused(page, path);
  });

  test('works on a phone', async ({ staff }) => {
    const page = await staff('worker', PHONE);
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Tasks', 'Settings']);
    await mainNav(page).getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
    await expectFitsViewport(page);
  });
});

test.describe('No-permission user', () => {
  test('gets Home only, with no dashboard figures or workspace cards', async ({ staff }) => {
    const page = await staff('noperm');
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Settings']);
    const main = page.getByRole('main');
    await expect(main.getByRole('link')).toHaveCount(0);
    const text = await main.innerText();
    for (const widget of ['RIGHT NOW', 'Queue today', 'Waiting', 'Events next 14 days', 'Overdue']) {
      expect(text).not.toContain(widget);
    }
    for (const item of PROTECTED_DATA) expect(text).not.toContain(item);
  });

  test('is refused on every protected route, with no data, no false empty state and no controls', async ({
    staff,
  }) => {
    const page = await staff('noperm');
    for (const path of [
      '/queue',
      '/queue/podium',
      '/banquet',
      '/banquet/kitchen',
      '/banquet/kds',
      '/tasks',
      '/reports',
      '/reports/queue.tokens',
    ]) {
      await expectRefused(page, path);
    }
  });

  test('works on a phone', async ({ staff }) => {
    const page = await staff('noperm', PHONE);
    await expect(mainNav(page).getByRole('link')).toHaveText(['Dashboard', 'Settings']);
    await expectFitsViewport(page);
  });
});

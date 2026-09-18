import type { BrowserContextOptions, Page } from '@playwright/test';
import { PHONE, expect, expectFitsViewport, test } from './fixtures';
import { SamcoApi } from './support/api';
import { BRANCH, USERS, testPassword, webOrigin } from './support/data';

/**
 * Browser acceptance for the SRS conformance work: banquet pricing, payments
 * and printable documents; branch tax settings; the availability calendar;
 * report drill-down; dashboard periods and All branches; typed checklist
 * answers and the reference library; signed-in devices; the audit log; and a
 * deep link surviving sign-in. Desktop, tablet and phone sizes.
 *
 * No test waits on a timer: every step waits for what the server confirmed.
 */

const TABLET: BrowserContextOptions = { viewport: { width: 768, height: 1024 }, hasTouch: true };

const GSTIN = '29AAPFU0939F1ZV';
const FSSAI = '11521999000123';

async function gotoMain(page: Page, path: string) {
  await page.goto(path);
  return page.getByRole('main');
}

test.describe('Conformance — banquet money and documents', () => {
  test('branch tax details reach the printed bill, and the change is in the audit log', async ({ staff, manager, data }) => {
    const page = await staff('manager');
    let main = await gotoMain(page, '/settings/branches');
    await main.getByRole('button', { name: `Edit tax details for ${BRANCH.bengaluru}` }).click();
    await main.getByLabel('GSTIN').fill(GSTIN.toLowerCase());
    await main.getByLabel('FSSAI licence number').fill(FSSAI);
    await main.getByRole('button', { name: 'Save' }).click();
    await expect(main.getByText(new RegExp(`Saved ${BRANCH.bengaluru}`))).toBeVisible();
    await expect(main.getByText(new RegExp(`GSTIN: ${GSTIN}`))).toBeVisible();

    main = await gotoMain(page, `/banquet/${data.bookingId}/bill`);
    const bill = main.getByRole('article', { name: 'Bill' });
    await expect(bill).toContainText(`GSTIN: ${GSTIN}`);
    await expect(bill).toContainText(`FSSAI Lic. No.: ${FSSAI}`);
    await expect(bill).toContainText('BANQUET BILL');
    await expect(bill).toContainText('Balance due');

    main = await gotoMain(page, '/settings/audit');
    await main.getByLabel('Record type').fill('BRANCH');
    await main.getByRole('button', { name: 'Apply' }).click();
    await expect(main.getByRole('table')).toContainText(`gstin: null → ${GSTIN}`);

    // Leave the shared fixture as it was for the rest of the run.
    await manager.send('PATCH', `branches/${data.branches.bengaluru}`, null, { gstin: null, fssai_license: null });
  });

  test('a charge re-prices the booking; a payment is recorded but only a second person may verify it', async ({ staff, data }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, `/banquet/${data.bookingId}`);
    await expect(main.getByRole('heading', { name: 'Bill & balance' })).toBeVisible();

    await main.getByLabel('Line type').selectOption({ label: 'Extra charge' });
    await main.getByLabel('Description').fill('Decoration');
    await main.getByLabel('Line amount (INR)').fill('1500');
    await main.getByRole('button', { name: 'Add line' }).click();
    await expect(main.getByText('Line added and the bill recalculated.')).toBeVisible();
    await expect(main.getByText('Extra charges')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Withdraw Decoration' })).toBeVisible();

    await main.getByLabel('Amount (INR)', { exact: true }).fill('1000');
    await main.getByRole('button', { name: 'Record payment' }).click();
    await expect(main.getByText('Payment recorded.')).toBeVisible();
    const history = main.getByRole('listitem').filter({ hasText: 'Advance' });
    await expect(history).toContainText('Not verified');
    // The recorder is never offered verification of their own payment.
    await expect(main.getByRole('button', { name: /^Verify payment/ })).toHaveCount(0);
  });

  test('the KOT says it is not a bill and carries no money or customer', async ({ staff, data }) => {
    const page = await staff('manager');
    const main = await gotoMain(page, `/banquet/${data.bookingId}`);
    await main.getByRole('link', { name: 'Print KOT' }).click();
    const kot = page.getByRole('article', { name: 'Kitchen order ticket' });
    await expect(kot).toContainText('NOT A BILL - KITCHEN ONLY');
    const text = await kot.innerText();
    expect(text).not.toMatch(/₹|INR|Priya|balance|total/i);
  });

  test('the availability calendar works on a phone without sideways page scroll', async ({ staff }) => {
    const page = await staff('manager', PHONE);
    const main = await gotoMain(page, '/banquet/calendar');
    await expect(main.getByRole('heading', { level: 1, name: 'Banquet Availability' })).toBeVisible();

    // The month grid, then the same window a month later.
    const grid = main.getByRole('list', { name: /availability$/ });
    await expect(grid).toBeVisible();
    const days = await grid.getByRole('button').count();
    expect(days).toBeGreaterThan(27);
    await expectFitsViewport(page);
    await main.getByRole('button', { name: 'Next month' }).click();
    await expect(grid).toBeVisible();

    // The week, reached from the view switch, scrolls inside itself.
    await main.getByRole('tab', { name: 'Weekly' }).click();
    await expect(main.getByRole('list', { name: 'Bookings this week' })).toBeVisible();
    await main.getByRole('button', { name: 'Next week' }).click();
    await expectFitsViewport(page);
  });
});

test.describe('Conformance — reports and dashboard', () => {
  test('an outstanding balance drills down to its booking on a tablet', async ({ staff, data }) => {
    const page = await staff('manager', TABLET);
    const main = await gotoMain(page, '/reports/banquet.outstanding');
    await expect(main.getByRole('heading', { level: 1, name: 'Banquet outstanding balances' })).toBeVisible();
    await expectFitsViewport(page);
    const link = main.getByRole('table').getByRole('link').first();
    await expect(link).toHaveAttribute('href', `/banquet/${data.bookingId}`);
    await link.click();
    await expect(page).toHaveURL((u) => u.pathname === `/banquet/${data.bookingId}`);
  });

  test('dashboard periods ask for a window, and All branches shows the sum', async ({ staff }) => {
    const page = await staff('manager');
    const main = page.getByRole('main');
    const period = main.getByRole('group', { name: 'Dashboard period' });
    await period.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(period.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');

    await period.getByRole('button', { name: 'All branches' }).click();
    await expect(main.getByText(/Totals across 2 branches: Bengaluru, Pallavaram/)).toBeVisible();
  });
});

test.describe('Conformance — routines', () => {
  test('a reference routine installs, and its typed items take answers', async ({ staff, manager, data }) => {
    const page = await staff('manager');
    let main = await gotoMain(page, '/tasks/checklists');
    await main.getByRole('button', { name: 'Install EOD Report' }).click();
    await expect(main.getByText('EOD Report installed.')).toBeVisible();

    const templates = await manager.send<{ data: Array<{ id: string; name: string }> }>('GET', 'checklists?limit=100', null);
    const eod = templates.data.find((t) => t.name === 'EOD Report')!;
    const task = await manager.send<{ id: string }>('POST', 'tasks', data.branches.bengaluru, {
      title: 'Close the day',
      checklist_template_id: eod.id,
    });

    main = await gotoMain(page, `/tasks/${task.id}`);
    const sales = main.getByRole('listitem').filter({ hasText: 'Morning sales' });
    await sales.getByLabel(/Morning sales/).fill('12500.5');
    await sales.getByRole('button', { name: 'Save' }).click();
    await expect(main.getByText('Answer saved.')).toBeVisible();
    await expect(sales).toContainText('answered 12500.5');

    const saved = await manager.send<{ checklist: Array<{ label: string; value: string | null }> }>(
      'GET',
      `tasks/${task.id}`,
      data.branches.bengaluru,
    );
    expect(saved.checklist.find((i) => i.label === 'Morning sales')?.value).toBe('12500.5');
  });
});

test.describe('Conformance — account and sign-in', () => {
  test('signing out another device ends that session at once', async ({ staff, data }) => {
    const other = await SamcoApi.login(USERS.manager.email, testPassword(), data.companyA);
    try {
      const page = await staff('manager');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
      await page.getByRole('main').getByRole('link', { name: /^Devices/ }).click();
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
      await expect(main.getByText('This device')).toBeVisible();

      const before = await main.getByRole('button', { name: /^Sign out ./ }).count();
      expect(before).toBeGreaterThan(0);
      // Sign out every other device, one server-confirmed step at a time.
      for (let remaining = before; remaining > 0; remaining--) {
        await main.getByRole('button', { name: /^Sign out ./ }).first().click();
        await expect(main.getByRole('button', { name: /^Sign out ./ })).toHaveCount(remaining - 1);
      }
      await expect(other.send('GET', 'auth/me', null)).rejects.toThrow(/401/);
      // This device is still signed in.
      await expect(main.getByText('This device')).toBeVisible();
    } finally {
      await other.dispose();
    }
  });

  test('a deep link survives signing in', async ({ browser, data }) => {
    const context = await browser.newContext({ baseURL: webOrigin() });
    try {
      const page = await context.newPage();
      await page.goto(`/banquet/${data.bookingId}`);
      await expect(page).toHaveURL((u) => u.pathname === '/login' && u.searchParams.get('next') === `/banquet/${data.bookingId}`);
      await page.getByLabel('Email').fill(USERS.manager.email);
      await test.step('enter the run password', async () => {
        await page.getByLabel('Password').fill(testPassword());
      });
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL((u) => u.pathname === `/banquet/${data.bookingId}`);
    } finally {
      await context.close();
    }
  });

  test('an off-site next parameter is ignored', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: webOrigin() });
    try {
      const page = await context.newPage();
      await page.goto('/login?next=//evil.example/steal');
      await page.getByLabel('Email').fill(USERS.manager.email);
      await test.step('enter the run password', async () => {
        await page.getByLabel('Password').fill(testPassword());
      });
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL((u) => u.origin === webOrigin() && u.pathname === '/');
    } finally {
      await context.close();
    }
  });
});

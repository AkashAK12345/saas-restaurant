import { PHONE, expect, expectFitsViewport, mainNav, test } from './fixtures';

/**
 * The queue screens on a phone, reached the way staff reach them: the
 * dashboard's Queue card, its sheet, then the queue's own tab bar. Every step
 * waits for what the server confirmed.
 */

test.describe('Queue screens on a phone', () => {
  test('dashboard sheet → register a party → it shows on the customer display and the admin display', async ({
    staff,
    manager,
    data,
  }) => {
    const branch = data.branches.bengaluru;
    const page = await staff('manager', PHONE);

    await page.getByRole('main').getByRole('button', { name: /^Queue/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Queue Management' });
    await expect(sheet.getByRole('link')).toHaveText([
      /Admin Display/,
      /Podium Operator/,
      /Customer Register/,
      /Waiter/,
      /Customer Display/,
    ]);
    await sheet.getByRole('link', { name: /Customer Register/ }).click();

    await expect(page).toHaveURL((u) => u.pathname === '/queue/register');
    await expect(page.getByRole('heading', { level: 1, name: 'Customer Register' })).toBeVisible();
    // The queue screens bring their own chrome in place of the app navigation.
    const tabs = page.getByRole('navigation', { name: 'Queue sections' });
    await expect(tabs).toBeVisible();
    await expect(mainNav(page)).toHaveCount(0);
    await expect(page.getByLabel('Next token')).toContainText(/\d+/);
    await expectFitsViewport(page);

    await page.getByLabel('Adults', { exact: true }).fill('3');
    await page.getByLabel('Kids', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Register Customer' }).click();
    const confirmation = page.getByRole('status').filter({ hasText: 'Added to the queue' });
    await expect(confirmation).toBeVisible();
    const issued = Number((await confirmation.getByLabel(/^Token \d+$/).textContent())?.trim());
    expect(issued).toBeGreaterThan(0);

    const party = (await manager.board(branch)).waiting.find((t) => t.token_number === issued);
    expect(party, 'the server holds the registered party').toBeTruthy();
    expect(party!.party_size).toBe(4);

    try {
      await tabs.getByRole('link', { name: 'Customer' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Customer Display' })).toBeVisible();
      const waiting = page.getByRole('region', { name: 'Waiting' });
      await expect(waiting.getByRole('listitem').filter({ hasText: new RegExp(`^${issued}$`) })).toBeVisible();
      await expect(page.getByText(/QR/i)).toHaveCount(0);
      await expectFitsViewport(page);

      await tabs.getByRole('link', { name: 'Display' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Queue Management' })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Queue totals' })).toContainText('Total Waiting');
      await expectFitsViewport(page);

      await tabs.getByRole('link', { name: 'Home' }).click();
      await expect(page).toHaveURL((u) => u.pathname === '/');
      await expect(mainNav(page)).toBeVisible();
    } finally {
      // Leave the shared waiting list as the other specs expect it.
      await manager.cancel(branch, party!.id);
    }
  });

  test('the podium registers on one tab and calls on the other', async ({ staff }) => {
    const page = await staff('manager', PHONE);
    await page.goto('/queue/podium');
    await expect(page.getByRole('heading', { level: 1, name: 'Podium Operator' })).toBeVisible();

    const register = page.getByRole('tab', { name: 'Register' });
    const call = page.getByRole('tab', { name: 'Call Customers' });
    await expect(register).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Next token')).toBeVisible();
    await expect(page.getByLabel('Advance booking time (optional)')).toBeVisible();
    await expectFitsViewport(page);

    await call.click();
    await expect(call).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Waiting totals')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register Customer' })).toHaveCount(0);
    await expectFitsViewport(page);
  });
});

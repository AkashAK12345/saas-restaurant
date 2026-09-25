import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { InventoryOverview } from '@/lib/inventory/api';

const overview = vi.hoisted(() => vi.fn());
const filters = vi.hoisted(() => vi.fn());
const saveFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/inventory/api', () => ({
  inventoryApi: { overview: (...a: unknown[]) => overview(...a), filters: (...a: unknown[]) => filters(...a) },
}));
vi.mock('@/lib/reports/api', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));

const { default: InventoryPage } = await import('@/app/(staff)/(app)/inventory/page');
const { compactMoney, quantity } = await import('@/lib/inventory/format');
const { itemsToCsv } = await import('@/lib/inventory/export');

const BRANCHES = [
  { id: 'b1', name: 'Pallavaram' },
  { id: 'b2', name: 'Velachery' },
];

function page(over: Partial<InventoryOverview> = {}): InventoryOverview {
  return {
    branches: BRANCHES,
    summary: { purchase_minor: 116_700_000, outstanding_minor: 121_500_000, open: 125, received: 175, currency: 'INR' },
    items: [
      {
        id: 'i1',
        name: '7 Up Bottle 24 X 600 Ml',
        unit: 'case',
        category: 'Beverages',
        department: null,
        cells: {
          b1: { stock: null, consumed: null, purchase: null },
          b2: { stock: 12.5, consumed: 3, purchase: 10 },
        },
      },
      {
        id: 'i2',
        name: 'Laptop',
        unit: 'BOX',
        category: 'Electronic',
        department: null,
        cells: { b1: { stock: 2, consumed: null, purchase: null }, b2: { stock: null, consumed: null, purchase: null } },
      },
    ],
    meta: { total: 666, limit: 100, offset: 0 },
    ...over,
  };
}

describe('Inventory screen', () => {
  beforeEach(() => {
    overview.mockReset();
    filters.mockReset();
    saveFile.mockReset();
    overview.mockResolvedValue(page());
    filters.mockResolvedValue({
      branches: BRANCHES,
      categories: [
        { id: 'c1', name: 'Beverages' },
        { id: 'c2', name: 'Meat' },
      ],
      departments: ['Indian', 'Chinese', 'Tandoori', 'BBQ', 'Turkish', 'Staff Food', 'Pick Up'],
    });
  });

  it('INV-1. the summary strip, the count, and a column group per branch', async () => {
    const { container } = render(<InventoryPage />);
    expect(await screen.findByText('666 items')).toBeTruthy();
    expect(
      [...container.querySelectorAll('dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    ).toEqual([
      ['Purchase', '₹11.67L'],
      ['Outstanding', '₹12.15L'],
      ['Open', '125'],
      ['Received', '175'],
    ]);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Item',
      'Pallavaram',
      'Velachery',
      'Stock',
      'Consumed',
      'Purchase',
      'Stock',
      'Consumed',
      'Purchase',
    ]);
    const row = within(table).getByRole('rowheader', { name: /7 Up Bottle/ }).closest('tr')!;
    expect([...row.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['—', '—', '—', '12.5', '3', '10']);
    expect(within(table).getByText('case')).toBeTruthy();
  });

  it('INV-2. each filter goes to the server; a search waits for typing to pause', async () => {
    render(<InventoryPage />);
    await screen.findByText('666 items');

    fireEvent.click(screen.getByRole('button', { name: 'Category: All categories' }));
    const panel = screen.getByRole('dialog', { name: 'Category' });
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'me' } });
    expect(within(panel).queryByText('Beverages')).toBeNull();
    fireEvent.click(within(panel).getByText('Meat'));
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ category_id: 'c2', offset: 0 }));

    fireEvent.click(screen.getByRole('button', { name: 'Department: All departments' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Department' })).getByText('Staff Food'));
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ department: 'Staff Food' }));

    fireEvent.click(screen.getByRole('button', { name: 'Branch: All branches' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Branch' })).getByText('Velachery'));
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ branch_id: 'b2' }));

    fireEvent.change(screen.getByPlaceholderText('Search items'), { target: { value: 'lap' } });
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ q: 'lap' }), { timeout: 2000 });
  });

  it('INV-3. dates bound the period, and can be cleared back to all time', async () => {
    render(<InventoryPage />);
    await screen.findByText('666 items');
    fireEvent.click(screen.getByRole('button', { name: 'Select dates' }));
    const dialog = screen.getByRole('dialog', { name: 'Select Date Range' });
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-09-17' } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-09-24' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ from: '2026-09-17', to: '2026-09-24' }));
    expect(screen.getByText('17 Sep 26 – 24 Sep 26')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
    await waitFor(() => expect(overview.mock.calls.at(-1)?.[1].from).toBeUndefined());
    // Steps through a dialog: slow when the whole suite shares the machine.
  }, 15_000);

  it('INV-4. Show more adds the next page under the first', async () => {
    render(<InventoryPage />);
    await screen.findByText('666 items');
    overview.mockResolvedValueOnce(
      page({
        items: [{ id: 'i3', name: 'Onion', unit: 'Kg', category: null, department: null, cells: {} }],
        meta: { total: 666, limit: 100, offset: 100 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show more (664 left)' }));
    await screen.findByText('Onion');
    expect(overview.mock.calls.at(-1)?.[1]).toMatchObject({ offset: 2 });
    expect(screen.getByText('Laptop')).toBeTruthy();
  });

  it('INV-5. download saves every page as CSV; the buttons still to come do nothing', async () => {
    render(<InventoryPage />);
    await screen.findByText('666 items');
    overview.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    // 666 items in pages of 200.
    expect(overview.mock.calls.map((c) => c[1].offset)).toEqual([0, 200, 400, 600]);
    expect(saveFile.mock.calls[0][0].filename).toMatch(/^inventory-\d{4}-\d{2}-\d{2}\.csv$/);

    for (const name of ['Manual purchase', 'Transfer', 'Reports', 'Search every branch', 'Suppliers']) {
      expect(screen.getByRole(name === 'Suppliers' ? 'tab' : 'button', { name }).getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('INV-6. a refusal is shown, not an empty grid', async () => {
    overview.mockRejectedValue(new Error('You do not have inventory access at any branch of this company'));
    render(<InventoryPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch('inventory access');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Inventory formats', () => {
  it('shows headline money the Indian way', () => {
    expect(compactMoney(116_700_000)).toBe('₹11.67L');
    expect(compactMoney(121_500_000)).toBe('₹12.15L');
    expect(compactMoney(1_240_000_000)).toBe('₹1.24Cr');
    expect(compactMoney(8_540_000)).toBe('₹85,400');
    expect(compactMoney(0)).toBe('₹0');
  });

  it('shows a quantity to three decimals, or a dash for nothing', () => {
    expect(quantity(1234.5)).toBe('1,234.5');
    expect(quantity(0.125)).toBe('0.125');
    expect(quantity(null)).toBe('—');
  });

  it('exports a CSV with a column trio per branch, blanks for nothing', () => {
    const csv = itemsToCsv(BRANCHES, page().items);
    const [header, first] = csv.replace('﻿', '').split('\r\n');
    expect(header).toBe(
      'Item,Unit,Category,Department,Pallavaram Stock,Pallavaram Consumed,Pallavaram Purchase,Velachery Stock,Velachery Consumed,Velachery Purchase',
    );
    expect(first).toBe('7 Up Bottle 24 X 600 Ml,case,Beverages,,,,,12.5,3,10');
  });
});

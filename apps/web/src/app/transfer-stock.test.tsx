import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  transferOptions: vi.fn(),
  transferStock: vi.fn(),
  recordTransfer: vi.fn(),
}));
vi.mock('@/lib/inventory/api', () => ({ inventoryApi: api }));
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({ selectedCompanyId: 'co-1' }),
}));

const { default: TransferStockPage } = await import('@/app/(staff)/(app)/inventory/transfer/page');
const { stockFigure } = await import('@/lib/inventory/format');

const PRODUCTS = [
  { id: 'p1', name: 'Appam Batter', category: null, unit: null },
  { id: 'p2', name: 'Chicken Biriyani', category: 'Biryani', unit: null },
];
const RAW = [
  { id: 'r1', name: 'Capsicum', unit: 'Kg', on_hand: 56 },
  { id: 'r2', name: 'Chicken Curry Cut', unit: 'Kg', on_hand: 11.2 },
  // None at this outlet: listed after what it holds, not sendable.
  { id: 'r3', name: 'Ajinomoto', unit: 'Kg', on_hand: 0 },
];

function pick(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByText(option));
}

const list = () => screen.getByRole('list', { name: 'Items to transfer' });
const transferButton = () => screen.getByRole('button', { name: /^Transfer \(/ }) as HTMLButtonElement;

describe('Transfer Stock screen', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.transferOptions.mockResolvedValue({
      sources: [
        { id: 'ck', name: 'Central Samco Kitchen' },
        { id: 'al', name: 'Alwarpet' },
      ],
      destinations: [
        { id: 'al', name: 'Alwarpet' },
        { id: 'ck', name: 'Central Samco Kitchen' },
        { id: 'pv', name: 'Pallavaram' },
      ],
    });
    api.transferStock.mockImplementation(async (_ctx: unknown, branchId: string | null) => ({
      raw_materials: branchId === 'ck' ? RAW : [],
      products: PRODUCTS,
    }));
  });

  it('TRW-1. starts as the reference does: no outlets chosen, the products listed, Transfer (0) off', async () => {
    render(<TransferStockPage />);
    expect(screen.getByRole('heading', { name: 'Transfer Stock' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Raw materials' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('button', { name: 'From outlet: none chosen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to: none chosen' })).toBeTruthy();
    expect(await within(list()).findByText('Chicken Biriyani')).toBeTruthy();
    expect(within(list()).getAllByText('Menu product · not stock-tracked')).toHaveLength(2);
    expect(transferButton().disabled).toBe(true);
    expect(transferButton().textContent).toBe('Transfer (0)');
  });

  it('TRW-2. a source shows its raw materials on hand; the chips and the search narrow the list', async () => {
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    pick('From outlet', 'Central Samco Kitchen');
    expect(await within(list()).findByText('On hand: 56 Kg')).toBeTruthy();
    expect(within(list()).getByText('On hand: 11.20 Kg')).toBeTruthy();
    expect(api.transferStock).toHaveBeenLastCalledWith({ companyId: 'co-1' }, 'ck');

    expect(within(list()).getByText('On hand: 0 Kg · none to send')).toBeTruthy();
    expect((within(list()).getByRole('checkbox', { name: /Ajinomoto/ }) as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Raw materials' }));
    expect(within(list()).queryByText('Chicken Biriyani')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    expect(within(list()).queryByText('Capsicum')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByPlaceholderText('Search items'), { target: { value: 'chick' } });
    expect(within(list()).getAllByRole('listitem').map((li) => li.querySelector('label')!.textContent)).toEqual([
      'Chicken Curry CutOn hand: 11.20 Kg',
      'Chicken BiriyaniProductMenu product · not stock-tracked',
    ]);

    // The destination never offers the source.
    fireEvent.click(screen.getByRole('button', { name: 'Send to: none chosen' }));
    const panel = screen.getByRole('dialog', { name: 'Send to' });
    expect(within(panel).queryByText('Central Samco Kitchen')).toBeNull();
    expect(within(panel).getByText('Pallavaram')).toBeTruthy();
  });

  it('TRW-3. ticking asks for a quantity; the reference’s prompts stop a transfer that is not ready', async () => {
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    pick('From outlet', 'Central Samco Kitchen');
    fireEvent.click(await within(list()).findByRole('checkbox', { name: /Capsicum/ }));
    expect(screen.getByLabelText('Quantity of Capsicum')).toBeTruthy();
    expect(transferButton().textContent).toBe('Transfer (1)');

    fireEvent.click(transferButton());
    expect(screen.getByRole('status').textContent).toBe('Select where to send from and where to send to');

    pick('Send to', 'Alwarpet');
    fireEvent.click(transferButton());
    expect(screen.getByRole('status').textContent).toBe('Enter quantities for the selected items');

    fireEvent.change(screen.getByLabelText('Quantity of Capsicum'), { target: { value: '57' } });
    fireEvent.click(transferButton());
    expect(screen.getByRole('status').textContent).toBe('Only 56 Kg of Capsicum on hand');
    expect(api.recordTransfer).not.toHaveBeenCalled();

    // Unticking forgets it.
    fireEvent.click(within(list()).getByRole('checkbox', { name: /Capsicum/ }));
    expect(screen.queryByLabelText('Quantity of Capsicum')).toBeNull();
    expect(transferButton().disabled).toBe(true);
  });

  it('TRW-4. sends raw materials and products together, then clears the ticks and reloads the stock', async () => {
    api.recordTransfer.mockResolvedValue({ id: 't1', number: 'TR-260925-1', from: 'Central Samco Kitchen', to: 'Alwarpet', items: 2 });
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    pick('From outlet', 'Central Samco Kitchen');
    pick('Send to', 'Alwarpet');
    fireEvent.click(await within(list()).findByRole('checkbox', { name: /Capsicum/ }));
    fireEvent.change(screen.getByLabelText('Quantity of Capsicum'), { target: { value: '2' } });
    fireEvent.click(within(list()).getByRole('checkbox', { name: /Chicken Biriyani/ }));
    fireEvent.change(screen.getByLabelText('Quantity of Chicken Biriyani'), { target: { value: '3' } });
    // A menu product without a unit of its own is counted in pieces.
    expect(screen.getByLabelText('Quantity of Chicken Biriyani').parentElement!.textContent).toContain('pcs');
    fireEvent.click(transferButton());

    // The success screen: what went where.
    const done = await screen.findByRole('dialog', { name: 'Transfer complete' });
    expect(within(done).getByText(/TR-260925-1 · 2 items sent from/).textContent).toBe(
      'TR-260925-1 · 2 items sent from Central Samco Kitchen to Alwarpet',
    );
    expect(within(done).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Capsicum2 Kg',
      'Chicken Biriyani3 pcs',
    ]);
    expect(within(done).getByRole('link', { name: 'Back to inventory' }).getAttribute('href')).toBe('/inventory');
    fireEvent.click(within(done).getByRole('button', { name: 'New transfer' }));
    expect(screen.queryByRole('dialog', { name: 'Transfer complete' })).toBeNull();
    expect(api.recordTransfer).toHaveBeenCalledWith(
      { companyId: 'co-1' },
      {
        from_branch_id: 'ck',
        to_branch_id: 'al',
        lines: [
          { kind: 'RAW', id: 'r1', quantity: 2 },
          { kind: 'PRODUCT', id: 'p2', quantity: 3 },
        ],
      },
    );
    expect(transferButton().textContent).toBe('Transfer (0)');
    await waitFor(() => expect(api.transferStock.mock.calls.filter((c) => c[1] === 'ck')).toHaveLength(2));
  });

  it('TRW-5. shows the server’s refusal, prefixed as the reference does', async () => {
    api.recordTransfer.mockRejectedValue(new Error('Only 1 Kg of Capsicum on hand at Central Samco Kitchen'));
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    pick('From outlet', 'Central Samco Kitchen');
    pick('Send to', 'Alwarpet');
    fireEvent.click(await within(list()).findByRole('checkbox', { name: /Capsicum/ }));
    fireEvent.change(screen.getByLabelText('Quantity of Capsicum'), { target: { value: '2' } });
    fireEvent.click(transferButton());
    expect((await screen.findByText(/^Failed:/)).textContent).toBe(
      'Failed: Only 1 Kg of Capsicum on hand at Central Samco Kitchen',
    );
    // What was ticked stays, to fix and retry.
    expect(transferButton().textContent).toBe('Transfer (1)');
  });

  it('TRW-6. the Assets tab: search, a required note, and no assets at the outlet', async () => {
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    expect(screen.getByPlaceholderText('Search assets')).toBeTruthy();
    expect(screen.getByPlaceholderText('Note (required) — reason / reference')).toBeTruthy();
    expect(screen.getByText('Select a source outlet to see its assets.')).toBeTruthy();
    pick('From outlet', 'Central Samco Kitchen');
    expect(screen.getByText('No assets with available units at this outlet.')).toBeTruthy();
    expect(transferButton().disabled).toBe(true);
  });

  it('TRW-7. changing the source drops raw materials ticked at the old one, and keeps products', async () => {
    render(<TransferStockPage />);
    await screen.findByRole('button', { name: 'From outlet: none chosen' });
    pick('From outlet', 'Central Samco Kitchen');
    fireEvent.click(await within(list()).findByRole('checkbox', { name: /Capsicum/ }));
    fireEvent.click(within(list()).getByRole('checkbox', { name: /Appam Batter/ }));
    expect(transferButton().textContent).toBe('Transfer (2)');
    pick('From outlet', 'Alwarpet');
    expect(transferButton().textContent).toBe('Transfer (1)');
  });
});

describe('stock figures', () => {
  it('shows whole stock plainly and a fraction to two or three places', () => {
    expect(stockFigure(56)).toBe('56');
    expect(stockFigure(11.2)).toBe('11.20');
    expect(stockFigure(825.15)).toBe('825.15');
    expect(stockFigure(0.125)).toBe('0.125');
  });
});

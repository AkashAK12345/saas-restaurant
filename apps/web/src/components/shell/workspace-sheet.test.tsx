import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push }) }));

import { WorkspaceGrid, workspaceItems } from './workspace-grid';

const links = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('link')
    .map((l) => [l.textContent, l.getAttribute('href')]);

describe('Workspace — the Queue sheet', () => {
  it('opens a sheet of exactly the queue screens the viewer may open', () => {
    render(<WorkspaceGrid permissions={['customers.view', 'queue.view', 'queue.seat']} hasBranch />);

    // Other modules stay plain links.
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/customers');

    const queue = screen.getByRole('button', { name: /Queue/ });
    expect(queue.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(queue);

    const dialog = screen.getByRole('dialog', { name: 'Queue Management' });
    expect(links(dialog)).toEqual([
      ['Admin DisplayLive queue overview', '/queue'],
      ['WaiterTable management', '/queue/tables'],
      ['Customer DisplayNow serving & waiting', '/queue/display'],
    ]);
  });

  it('lists podium and register for someone who registers and calls', () => {
    render(<WorkspaceGrid permissions={['queue.view', 'queue.register', 'queue.call']} hasBranch />);
    fireEvent.click(screen.getByRole('button', { name: /Queue/ }));
    const titles = links(screen.getByRole('dialog')).map(([text]) => text);
    expect(titles).toEqual([
      'Admin DisplayLive queue overview',
      'Podium OperatorRegister & call customers',
      'Customer RegisterSelf check-in',
      'Customer DisplayNow serving & waiting',
    ]);
  });

  it('closes on Escape, on the close button, and when a screen is chosen', () => {
    render(<WorkspaceGrid permissions={['queue.view']} hasBranch />);
    const queue = screen.getByRole('button', { name: /Queue/ });

    fireEvent.click(queue);
    expect(queue.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(queue);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(queue);
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('link')[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the Queue card for any queue screen, and not without one or without a branch', () => {
    const hrefs = (p: string[], b = true) => workspaceItems(p, b).map((i) => i.href);
    expect(hrefs(['queue.seat'])).toContain('/queue');
    expect(hrefs(['tables.view'])).not.toContain('/queue');
    expect(hrefs(['queue.view'], false)).not.toContain('/queue');
  });
});

describe('Workspace — the Reports sheet', () => {
  const openReports = (permissions: string[] = ['reports.view']) => {
    render(<WorkspaceGrid permissions={permissions} hasBranch />);
    const card = screen.getByRole('button', { name: /Reports/ });
    expect(card.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(card);
    return { card, dialog: screen.getByRole('dialog', { name: 'Reports' }) };
  };

  const rows = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'Close reports')
      .map((b) => b.textContent);

  it('lists every checklist report, titled and subtitled as the design sets out', () => {
    const { dialog } = openReports();
    expect(rows(dialog)).toEqual([
      'Operational ChecklistChecklist reports',
      'Kitchen ChecklistKitchen reports',
      'Branch Head OpeningBranch head opening reports',
      'Banquet OpeningBanquet opening reports',
      'BM ChecklistBM reports',
      'Kitchen BalanceBalance reports',
      'Biryani SalesSales reports',
      'Kitchen Stock RequestStock reports',
    ]);
  });

  it('closes on Escape, on the close control, and when a report is chosen', () => {
    const { card } = openReports();
    expect(card.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Close reports' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(card);
    fireEvent.click(rowButtons()[0]);
    expect(screen.queryByRole('dialog')).toBeNull();

    function rowButtons() {
      return within(screen.getByRole('dialog'))
        .getAllByRole('button')
        .filter((b) => b.textContent !== 'Close reports');
    }
  });

  it('opens the report behind a row, and only closes the sheet for one not built yet', () => {
    push.mockClear();
    const { card } = openReports();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Operational Checklist/ }));
    expect(push).toHaveBeenCalledWith('/reports/tasks.operational');

    push.mockClear();
    fireEvent.click(card);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Kitchen Stock Request/ }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs the reports permission and a branch before the card appears', () => {
    const hrefs = (p: string[], b = true) => workspaceItems(p, b).map((i) => i.href);
    expect(hrefs(['reports.view'])).toContain('/reports');
    expect(hrefs(['customers.view'])).not.toContain('/reports');
    expect(hrefs(['reports.view'], false)).not.toContain('/reports');
  });
});

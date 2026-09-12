import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const register = vi.fn();
const createCustomer = vi.fn();
const customers = vi.fn();

vi.mock('@/lib/queue/api', () => ({
  queueApi: {
    register: (...a: unknown[]) => register(...a),
    createCustomer: (...a: unknown[]) => createCustomer(...a),
    customers: (...a: unknown[]) => customers(...a),
  },
}));

let branchPermissions: string[] = [];
let companyPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

import RegisterPage from './(staff)/(app)/queue/register/page';

const token = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  token_number: 12,
  adults: 2,
  kids: 0,
  party_size: 2,
  advance_booking_at: null,
  customer: null,
  ...over,
});

describe('Customer Register', () => {
  beforeEach(() => {
    register.mockReset().mockResolvedValue(token());
    createCustomer.mockReset().mockResolvedValue({ id: 'c-new', name: 'New Guest', phone: null, status: 'ACTIVE' });
    customers.mockReset().mockResolvedValue({
      data: [
        { id: 'c-1', name: 'Asha Rao', phone: '+919876500001', status: 'ACTIVE' },
        { id: 'c-2', name: 'Bo Chen', phone: null, status: 'ACTIVE' },
        { id: 'c-3', name: 'Gone Away', phone: null, status: 'INACTIVE' },
      ],
      meta: { total: 3, limit: 100, offset: 0 },
    });
    branchPermissions = ['queue.register'];
    companyPermissions = ['customers.view', 'customers.create'];
  });

  it('registers an anonymous walk-in with one press — no customer details at all', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][1]).toEqual({ adults: 2 });
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('shows the issued token number prominently afterwards', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText('12')).toBeTruthy();
    expect(screen.getByText(/Added to the queue/)).toBeTruthy();
  });

  it('adjusts adults with the stepper and the field', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase adults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase adults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 4 }));

    register.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Register another party' }));
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 8 }));
  });

  // Kids are optional, so a party with none sends no `kids` at all rather than
  // a zero the server would have defaulted anyway.
  it('sends kids only when there are some, and shows the derived total', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Kids'), { target: { value: '3' } });
    expect(screen.getByText(/5 guests in total/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 2, kids: 3 }));
  });

  // "1 kids" shipped once; the split is shown only when there are kids, and
  // each count agrees with its own noun.
  it('pluralises the adults/kids split on the confirmation', async () => {
    register.mockResolvedValueOnce(token({ adults: 2, kids: 1, party_size: 3 }));
    const { unmount } = render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText(/\(2 adults, 1 kid\)/)).toBeTruthy();
    expect(screen.queryByText(/1 kids/)).toBeNull();
    unmount();

    register.mockResolvedValueOnce(token({ adults: 1, kids: 2, party_size: 3 }));
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText(/\(1 adult, 2 kids\)/)).toBeTruthy();
  });

  // The TOTAL is the server's to compute; the screen must never send one.
  it('never sends a party_size of its own', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Kids'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][1]).not.toHaveProperty('party_size');
  });

  it('never lets the counts leave their bounds', () => {
    render(<RegisterPage />);
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;
    fireEvent.change(adults, { target: { value: '0' } });
    expect(adults.value).toBe('1');
    fireEvent.change(adults, { target: { value: '999' } });
    expect(adults.value).toBe('100');

    // Kids may legitimately be zero, where adults may not.
    const kids = screen.getByLabelText('Kids') as HTMLInputElement;
    fireEvent.change(kids, { target: { value: '-4' } });
    expect(kids.value).toBe('0');
    fireEvent.change(kids, { target: { value: '999' } });
    expect(kids.value).toBe('100');
  });

  it('links an existing customer chosen from the lookup', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Existing customer' }));

    const asha = await screen.findByRole('button', { name: /Asha Rao/ });
    fireEvent.click(asha);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-1' });
  });

  it('filters the lookup and hides inactive customers', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Existing customer' }));
    await screen.findByRole('button', { name: /Asha Rao/ });

    expect(screen.queryByRole('button', { name: /Gone Away/ })).toBeNull();

    fireEvent.change(screen.getByLabelText('Find a customer'), { target: { value: 'chen' } });
    expect(screen.queryByRole('button', { name: /Asha Rao/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Bo Chen/ })).toBeTruthy();
  });

  it('creates a customer only when explicitly asked, then registers with it', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New customer' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Guest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    // A phone is never required.
    expect(createCustomer.mock.calls[0][1]).toEqual({ name: 'New Guest' });
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-new' });
  });

  it('refuses to submit an empty new-customer name instead of registering silently', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter a name/);
    expect(register).not.toHaveBeenCalled();
  });

  it("surfaces the backend's error and stays on the form", async () => {
    register.mockRejectedValue(new Error('Customer is inactive'));
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Customer is inactive');
    expect(screen.getByRole('button', { name: 'Add to queue' })).toBeTruthy();
  });

  it('offers only the customer modes the permissions allow', () => {
    companyPermissions = [];
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: 'Walk-in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Existing customer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New customer' })).toBeNull();
  });

  it('renders nothing usable without queue.register — the API would refuse anyway', () => {
    branchPermissions = [];
    render(<RegisterPage />);
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull();
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });
});

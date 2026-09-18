import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const register = vi.fn();
const createCustomer = vi.fn();
const findCustomers = vi.fn();
const updateCustomer = vi.fn();

vi.mock('@/lib/queue/api', () => ({
  queueApi: {
    register: (...a: unknown[]) => register(...a),
    createCustomer: (...a: unknown[]) => createCustomer(...a),
    findCustomers: (...a: unknown[]) => findCustomers(...a),
    updateCustomer: (...a: unknown[]) => updateCustomer(...a),
  },
}));

const refresh = vi.fn().mockResolvedValue(undefined);
const boardCtx = vi.fn();
vi.mock('@/lib/queue/use-queue-board', () => ({
  useQueueBoard: (ctx: unknown) => {
    boardCtx(ctx);
    return {
      board: ctx ? { next_token_number: 12 } : null,
      loading: false,
      error: null,
      stream: 'open',
      updatedAt: 1,
      refresh,
    };
  },
}));

vi.mock('@/components/shell/branch-chip', () => ({ BranchChip: () => null }));

let branchPermissions: string[] = [];
let companyPermissions: string[] = [];
vi.mock('@/lib/context/app-context-provider', () => ({
  useAppContext: () => ({
    selectedCompanyId: 'co-1',
    selectedBranchId: 'br-1',
    selectedBranch: { id: 'br-1', name: 'Alpha Main', timezone: 'Asia/Kolkata', status: 'ACTIVE', has_roles: true },
    companyPermissions,
    branchPermissions,
    loading: false,
  }),
}));

import RegisterPage from './(staff)/(app)/queue/register/page';

const CTX = { companyId: 'co-1', branchId: 'br-1' };

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

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Register Customer' }));

describe('Customer Register', () => {
  beforeEach(() => {
    register.mockReset().mockResolvedValue(token());
    createCustomer.mockReset().mockResolvedValue({ id: 'c-new', name: 'New Guest', phone: null, status: 'ACTIVE' });
    findCustomers.mockReset().mockResolvedValue({ data: [], meta: { total: 0, limit: 25, offset: 0 } });
    updateCustomer.mockReset().mockResolvedValue({});
    refresh.mockClear();
    boardCtx.mockClear();
    branchPermissions = ['queue.register', 'queue.view'];
    companyPermissions = ['customers.view', 'customers.create'];
  });

  it('shows the screen title and the next token number from the board', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Customer Register' })).toBeTruthy();
    expect(screen.getByLabelText('Next token').textContent).toMatch(/Next Token\s*12/);
    expect(boardCtx).toHaveBeenCalledWith(CTX);
  });

  it('asks for name, phone, adults and kids — and no advance booking', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/Customer Name/)).toBeTruthy();
    expect(screen.getByLabelText(/Phone Number/)).toBeTruthy();
    expect(screen.getByLabelText('Adults')).toBeTruthy();
    expect(screen.getByLabelText('Kids')).toBeTruthy();
    expect(screen.queryByLabelText(/Advance booking/)).toBeNull();
  });

  it('registers an anonymous walk-in with one press — no customer lookups or records', async () => {
    render(<RegisterPage />);
    submit();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0]).toEqual([CTX, { adults: 2 }]);
    expect(findCustomers).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('shows the issued token prominently afterwards and refreshes the next number', async () => {
    render(<RegisterPage />);
    submit();
    const status = await screen.findByRole('status');
    expect(within(status).getByLabelText('Token 12')).toBeTruthy();
    expect(status.textContent).toMatch(/Added to the queue/);
    expect(refresh).toHaveBeenCalled();
  });

  it('adjusts adults with the stepper and the field', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase adults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase adults' }));
    submit();
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 4 }));

    register.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Register another' }));
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '8' } });
    submit();
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 8 }));
  });

  it('sends kids only when there are some, and shows the derived total', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Kids'), { target: { value: '3' } });
    expect(screen.getByText(/5 guests in total/)).toBeTruthy();
    submit();
    await waitFor(() => expect(register.mock.calls[0][1]).toEqual({ adults: 2, kids: 3 }));
    expect(register.mock.calls[0][1]).not.toHaveProperty('party_size');
  });

  it('pluralises the adults/kids split on the confirmation', async () => {
    register.mockResolvedValueOnce(token({ adults: 2, kids: 1, party_size: 3 }));
    const { unmount } = render(<RegisterPage />);
    submit();
    expect(await screen.findByText(/\(2 adults, 1 kid\)/)).toBeTruthy();
    expect(screen.queryByText(/1 kids/)).toBeNull();
    unmount();

    register.mockResolvedValueOnce(token({ adults: 1, kids: 2, party_size: 3 }));
    render(<RegisterPage />);
    submit();
    expect(await screen.findByText(/\(1 adult, 2 kids\)/)).toBeTruthy();
  });

  it('never lets the counts leave their bounds', () => {
    render(<RegisterPage />);
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;
    fireEvent.change(adults, { target: { value: '0' } });
    expect(adults.value).toBe('1');
    fireEvent.change(adults, { target: { value: '999' } });
    expect(adults.value).toBe('100');

    const kids = screen.getByLabelText('Kids') as HTMLInputElement;
    fireEvent.change(kids, { target: { value: '-4' } });
    expect(kids.value).toBe('0');
  });

  it('reuses the existing customer whose phone matches, without creating one', async () => {
    findCustomers.mockResolvedValue({
      data: [
        { id: 'c-9', name: 'Other', phone: '+919876500009', status: 'ACTIVE' },
        { id: 'c-1', name: 'Asha Rao', phone: '+919876500001', status: 'ACTIVE' },
      ],
      meta: { total: 2, limit: 25, offset: 0 },
    });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '98765 00001' } });
    submit();

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(findCustomers).toHaveBeenCalledWith(CTX, '9876500001');
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-1' });
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('syncs a corrected name onto the matched customer when permitted', async () => {
    companyPermissions = ['customers.view', 'customers.create', 'customers.update'];
    findCustomers.mockResolvedValue({
      data: [{ id: 'c-1', name: 'Asha Rao', phone: '+919876500001', status: 'ACTIVE' }],
      meta: { total: 1, limit: 25, offset: 0 },
    });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: 'Asha Nair' } });
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '98765 00001' } });
    submit();

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled());
    expect(updateCustomer).toHaveBeenCalledWith(CTX, 'c-1', { name: 'Asha Nair' });
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-1' });
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('does not sync the name onto the matched customer without customers.update', async () => {
    findCustomers.mockResolvedValue({
      data: [{ id: 'c-1', name: 'Asha Rao', phone: '+919876500001', status: 'ACTIVE' }],
      meta: { total: 1, limit: 25, offset: 0 },
    });
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: 'Asha Nair' } });
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '98765 00001' } });
    submit();

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-1' });
  });

  it('creates a customer from the typed name and phone when no one matches', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: '  New Guest ' } });
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '9000000000' } });
    submit();

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(createCustomer).toHaveBeenCalledWith(CTX, { name: 'New Guest', phone: '9000000000' });
    expect(register.mock.calls[0][1]).toEqual({ adults: 2, customer_id: 'c-new' });
  });

  it('creates a customer from a name alone — a phone is never required', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: 'New Guest' } });
    submit();
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(findCustomers).not.toHaveBeenCalled();
    expect(createCustomer).toHaveBeenCalledWith(CTX, { name: 'New Guest' });
  });

  it('refuses an unknown phone without a name instead of registering silently', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '9000000000' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter the customer’s name/);
    expect(register).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('does not create the customer twice when the registration is retried', async () => {
    register.mockRejectedValueOnce(new Error('Queue is closed'));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: 'New Guest' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Queue is closed');

    submit();
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[1][1]).toEqual({ adults: 2, customer_id: 'c-new' });
  });

  it('offers only the customer fields the permissions allow', () => {
    companyPermissions = ['customers.view'];
    const { unmount } = render(<RegisterPage />);
    expect(screen.queryByLabelText(/Customer Name/)).toBeNull();
    expect(screen.getByLabelText(/Phone Number/)).toBeTruthy();
    unmount();

    companyPermissions = [];
    render(<RegisterPage />);
    expect(screen.queryByLabelText(/Phone Number/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Register Customer' })).toBeTruthy();
  });

  it("surfaces the backend's error and stays on the form", async () => {
    register.mockRejectedValue(new Error('Customer is inactive'));
    render(<RegisterPage />);
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Customer is inactive');
    expect(screen.getByRole('button', { name: 'Register Customer' })).toBeTruthy();
  });

  it('still registers without queue.view, showing no next number and asking for no board', async () => {
    branchPermissions = ['queue.register'];
    render(<RegisterPage />);
    expect(boardCtx).toHaveBeenCalledWith(null);
    expect(screen.getByLabelText('Next token').textContent).toMatch(/—/);
    submit();
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it('renders nothing usable without queue.register — the API would refuse anyway', () => {
    branchPermissions = ['queue.view'];
    render(<RegisterPage />);
    expect(screen.queryByRole('button', { name: 'Register Customer' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/do not have permission/i);
    expect(boardCtx).toHaveBeenCalledWith(null);
  });
});

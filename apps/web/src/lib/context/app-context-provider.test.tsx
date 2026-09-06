import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { AuthContextResponse } from '@/lib/api/types';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...orig, api: { ...orig.api, get: (...a: unknown[]) => apiGet(...a) } };
});

let authStatus: 'loading' | 'authenticated' | 'unauthenticated' = 'authenticated';
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: authStatus, user: { id: 'u1' }, login: vi.fn(), logout: vi.fn() }),
}));

import { AppContextProvider, useAppContext } from './app-context-provider';
import { ApiError } from '@/lib/api/client';

const base: AuthContextResponse = {
  user: { id: 'u1', email: 'a@b.c', first_name: null, last_name: null },
  companies: [
    { id: 'co-A', name: 'Alpha', status: 'ACTIVE' },
    { id: 'co-B', name: 'Beta', status: 'SUSPENDED' },
  ],
  company: null,
  branch: null,
};

function Probe() {
  const ctx = useAppContext();
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="companies">{ctx.companies.map((c) => c.id).join(',')}</span>
      <span data-testid="company">{ctx.selectedCompanyId ?? '-'}</span>
      <span data-testid="branch">{ctx.selectedBranchId ?? '-'}</span>
      <span data-testid="branches">{ctx.branches.map((b) => b.id).join(',')}</span>
      <span data-testid="cperms">{ctx.companyPermissions.join(',')}</span>
      <span data-testid="bperms">{ctx.branchPermissions.join(',')}</span>
      <span data-testid="error">{ctx.error ?? '-'}</span>
      <button onClick={() => ctx.selectCompany('co-A')}>selA</button>
      <button onClick={() => ctx.selectCompany('co-X')}>selX</button>
      <button onClick={() => ctx.selectBranch('br-1')}>selBr</button>
    </div>
  );
}

describe('AppContextProvider', () => {
  beforeEach(() => {
    apiGet.mockReset();
    authStatus = 'authenticated';
  });

  it('loads selectable companies with no selection', async () => {
    apiGet.mockResolvedValue(base);
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('companies').textContent).toBe('co-A,co-B');
    expect(screen.getByTestId('company').textContent).toBe('-');
    expect(apiGet).toHaveBeenLastCalledWith('/auth/context', { companyId: null, branchId: null });
  });

  it('selecting a company re-requests context WITH the header and exposes its branches + permissions', async () => {
    apiGet.mockImplementation(async (_p: string, o: { companyId: string | null; branchId: string | null }) =>
      o.companyId === 'co-A'
        ? {
            ...base,
            company: {
              ...base.companies[0],
              permissions: ['customers.view', 'tables.view'],
              branches: [{ id: 'br-1', name: 'HQ', status: 'ACTIVE', timezone: 'UTC', has_roles: true }],
            },
            branch: o.branchId === 'br-1' ? { id: 'br-1', name: 'HQ', status: 'ACTIVE', timezone: 'UTC', permissions: ['tables.view'] } : null,
          }
        : base,
    );
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => screen.getByText('selA').click());
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('co-A'));
    expect(apiGet).toHaveBeenLastCalledWith('/auth/context', { companyId: 'co-A', branchId: null });
    expect(screen.getByTestId('branches').textContent).toBe('br-1');
    expect(screen.getByTestId('cperms').textContent).toBe('customers.view,tables.view');
    expect(screen.getByTestId('bperms').textContent).toBe('');

    await act(async () => screen.getByText('selBr').click());
    await waitFor(() => expect(screen.getByTestId('branch').textContent).toBe('br-1'));
    expect(apiGet).toHaveBeenLastCalledWith('/auth/context', { companyId: 'co-A', branchId: 'br-1' });
    expect(screen.getByTestId('bperms').textContent).toBe('tables.view');
    // Selection is remembered for the tab.
    expect(window.sessionStorage.getItem('samco.ctx.company')).toBe('co-A');
    expect(window.sessionStorage.getItem('samco.ctx.branch')).toBe('br-1');
  });

  it('a company the SERVER does not grant (404) is dropped, never shown as selected', async () => {
    apiGet.mockImplementation(async (_p: string, o: { companyId: string | null }) => {
      if (o.companyId === 'co-X') throw new ApiError(404, { statusCode: 404, message: 'Not Found' }, 'nf');
      return base;
    });
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => screen.getByText('selX').click());
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('company').textContent).toBe('-');
    expect(screen.getByTestId('cperms').textContent).toBe('');
    expect(screen.getByTestId('error').textContent).toBe('-'); // silently reset, not an app error
    expect(window.sessionStorage.getItem('samco.ctx.company')).toBeNull();
  });

  it('a stale remembered selection is validated against the server on load', async () => {
    window.sessionStorage.setItem('samco.ctx.company', 'co-gone');
    apiGet.mockImplementation(async (_p: string, o: { companyId: string | null }) => {
      if (o.companyId === 'co-gone') throw new ApiError(404, { statusCode: 404, message: 'Not Found' }, 'nf');
      return base;
    });
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('company').textContent).toBe('-');
    expect(window.sessionStorage.getItem('samco.ctx.company')).toBeNull();
  });

  it('non-404 failures surface as an error the shell can show', async () => {
    apiGet.mockRejectedValue(new ApiError(500, { statusCode: 500, message: 'Internal server error' }, 'x'));
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Internal server error'));
  });

  it('does nothing while unauthenticated', async () => {
    authStatus = 'unauthenticated';
    apiGet.mockResolvedValue(base);
    render(<AppContextProvider><Probe /></AppContextProvider>);
    await new Promise((r) => setTimeout(r, 10));
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.getByTestId('companies').textContent).toBe('');
  });
});

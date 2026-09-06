import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let status: 'loading' | 'authenticated' | 'unauthenticated' = 'loading';
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status, user: null, login: vi.fn(), logout: vi.fn() }),
}));

import * as nav from 'next/navigation';
import { AuthGate } from './auth-gate';

const mocks = (nav as unknown as { __mocks: { replace: ReturnType<typeof vi.fn> } }).__mocks;

describe('AuthGate', () => {
  it('shows a status while the session is being checked, without children', () => {
    status = 'loading';
    render(<AuthGate><div>SECRET</div></AuthGate>);
    expect(screen.getByRole('status').textContent).toMatch(/Checking/);
    expect(screen.queryByText('SECRET')).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('redirects to /login when unauthenticated and renders no children', () => {
    status = 'unauthenticated';
    render(<AuthGate><div>SECRET</div></AuthGate>);
    expect(mocks.replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  it('renders children when authenticated', () => {
    status = 'authenticated';
    render(<AuthGate><div>SECRET</div></AuthGate>);
    expect(screen.getByText('SECRET')).toBeDefined();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

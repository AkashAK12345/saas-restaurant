import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';

const login = vi.fn();
let status: 'loading' | 'authenticated' | 'unauthenticated' = 'unauthenticated';
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status, user: null, login, logout: vi.fn() }),
}));

import * as nav from 'next/navigation';
import LoginPage from './(staff)/(auth)/login/page';

const mocks = (nav as unknown as { __mocks: { replace: ReturnType<typeof vi.fn> } }).__mocks;

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset();
    status = 'unauthenticated';
  });

  it('submits credentials and navigates home on success', async () => {
    login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/'));
    expect(login).toHaveBeenCalledWith('a@b.c', 'pw');
  });

  it('shows the backend\'s generic error verbatim and stays on the page', async () => {
    login.mockRejectedValue(new ApiError(401, { statusCode: 401, message: 'Invalid credentials' }, 'x'));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid credentials');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('shows a throttle message (429) without leaking anything else', async () => {
    login.mockRejectedValue(
      new ApiError(429, { statusCode: 429, message: 'Too many failed login attempts. Try again in 900 seconds.' }, 'x'),
    );
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many failed login attempts/);
  });

  it('disables submit until both fields are filled', () => {
    render(<LoginPage />);
    const btn = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    expect(btn.disabled).toBe(false);
  });

  it('sends an already-authenticated visitor straight to the app', () => {
    status = 'authenticated';
    render(<LoginPage />);
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });
});

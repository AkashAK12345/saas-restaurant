import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const publicMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, api: { ...actual.api, public: (...a: unknown[]) => publicMock(...a) } };
});
vi.mock('@/components/brand/logo', () => ({ Logo: () => null }));

import { ApiError } from '@/lib/api/client';
import ForgotPasswordPage from './(staff)/(auth)/forgot-password/page';

const SENT = 'If this account can be recovered, a 6-digit code has been sent to its email. It expires in 10 minutes.';

describe('Forgot password', () => {
  beforeEach(() => publicMock.mockReset());

  const askForCode = async () => {
    publicMock.mockResolvedValueOnce({ message: SENT });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Enter the code' });
  };

  it('asks for a code and shows the same reply the server gives every email', async () => {
    await askForCode();
    expect(publicMock).toHaveBeenCalledWith('/auth/password-recovery/request', {
      method: 'POST',
      body: { email: 'me@test.com' },
    });
    expect(screen.getByRole('status').textContent).toBe(SENT);
    // Resending waits out the cooldown.
    expect((screen.getByRole('button', { name: /Send a new code in/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('checks the code and passwords, then sets the new password', async () => {
    await askForCode();
    const submit = screen.getByRole('button', { name: 'Set new password' });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12a34' } });
    fireEvent.click(submit);
    expect(screen.getByRole('alert').textContent).toMatch(/6-digit code/);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Owner#2026' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Owner#2027' } });
    fireEvent.click(submit);
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/);

    publicMock.mockResolvedValueOnce({ reset: true });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Owner#2026' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(publicMock).toHaveBeenLastCalledWith('/auth/password-recovery/reset', {
        method: 'POST',
        body: { email: 'me@test.com', code: '123456', new_password: 'Owner#2026' },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('shows the server’s refusal, e.g. a wrong code or email not set up', async () => {
    publicMock.mockRejectedValueOnce(new ApiError(503, { message: 'Password recovery by email is not set up yet.' } as never, 'Service unavailable'));
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('not set up yet');
  });
});

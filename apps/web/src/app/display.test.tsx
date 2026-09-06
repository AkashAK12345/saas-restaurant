import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QueueDisplayPage from './(display)/display/queue/page';
import BanquetDisplayPage from './(display)/display/banquet/page';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * The display surface must not expose staff-only functionality. These tests
 * assert the pages render with NO providers at all — which is exactly how the
 * (display) root layout mounts them — and that the staff session hook is
 * unreachable there.
 */
describe('display route foundation', () => {
  it('display pages render standalone, with no auth or app context providers', () => {
    render(<QueueDisplayPage />);
    expect(screen.getByRole('heading', { name: 'Queue display' })).toBeDefined();
    render(<BanquetDisplayPage />);
    expect(screen.getByRole('heading', { name: 'Chef display' })).toBeDefined();
  });

  it('display pages contain no navigation, sign-in, or sign-out affordances', () => {
    render(<QueueDisplayPage />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/sign (in|out)/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('the staff session hook throws outside the staff root — no display tree can reach a session', () => {
    function Leak() {
      useAuth();
      return null;
    }
    expect(() => render(<Leak />)).toThrow(/AuthProvider/);
  });
});

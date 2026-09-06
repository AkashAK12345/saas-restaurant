import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// next/navigation hooks need a router context that jsdom does not provide.
// Tests that care about navigation assert against these mocks.
vi.mock('next/navigation', () => {
  const replace = vi.fn();
  const push = vi.fn();
  return {
    useRouter: () => ({ replace, push, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
    __mocks: { replace, push },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

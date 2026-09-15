'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { loginPathFor } from '@/lib/auth/next-path';

/**
 * Keeps unauthenticated users out of the staff shell by sending them to
 * /login. This is a UX guard: it stops a signed-out tablet from rendering an
 * empty shell. It is not a security boundary — every piece of data the shell
 * shows is fetched from an API that authenticates and authorizes the request
 * itself.
 *
 * The page they were trying to reach travels along as `next`, so a shared
 * deep link lands where it pointed after signing in (validated on the way
 * back; see lib/auth/next-path.ts).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(loginPathFor(window.location.pathname, window.location.search));
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <p role="status" aria-live="polite" style={{ padding: 24 }}>
        {status === 'loading' ? 'Checking your session…' : 'Redirecting to sign in…'}
      </p>
    );
  }
  return <>{children}</>;
}

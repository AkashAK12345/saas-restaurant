'use client';

import { useEffect } from 'react';

/**
 * Segment error boundary. Next 16 passes `retry` (the older `reset` name is
 * gone) — see node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
      <button type="button" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}

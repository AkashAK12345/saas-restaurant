'use client';

import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * Home. Foundation placeholder: confirms the session and current context.
 * Module dashboards (Phase 10) will replace this.
 */
export default function HomePage() {
  const { user } = useAuth();
  const ctx = useAppContext();

  return (
    <section>
      <h1>Welcome{user?.first_name ? `, ${user.first_name}` : ''}</h1>
      {!ctx.selectedCompanyId ? (
        <p>Select a company to get started.</p>
      ) : !ctx.selectedBranchId ? (
        <p>Select a branch to see branch operations.</p>
      ) : (
        <p>Ready. Use the navigation to open a module.</p>
      )}
    </section>
  );
}

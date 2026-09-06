import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppContextProvider } from '@/lib/context/app-context-provider';
import { AppShell } from '@/components/shell/app-shell';

/**
 * Authenticated application area. Order matters:
 *   AuthGate       — nothing below renders until the session is confirmed
 *   AppContextProvider — company/branch selection + effective permissions
 *   AppShell       — chrome, navigation, loading/error states
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppContextProvider>
        <AppShell>{children}</AppShell>
      </AppContextProvider>
    </AuthGate>
  );
}

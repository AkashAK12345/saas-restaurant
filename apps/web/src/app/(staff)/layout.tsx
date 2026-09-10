import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../globals.css';
import { AuthProvider } from '@/lib/auth/auth-provider';

export const metadata: Metadata = {
  title: 'SAMCO',
  description: 'SAMCO restaurant & hospitality management',
  icons: { icon: '/brand/samco-mark.png', apple: '/brand/samco-mark.png' },
};

/**
 * ROOT LAYOUT for every STAFF route — (auth) and (app) nest beneath it.
 *
 * Display screens use a *different* root layout under (display) that never
 * mounts AuthProvider. Two root layouts, one per audience, is the mechanism
 * that keeps staff sessions structurally out of public display pages: there is
 * no component tree in which a display page could reach a staff session.
 */
export default function StaffRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

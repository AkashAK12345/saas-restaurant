import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../globals.css';
import styles from './display-layout.module.css';

export const metadata: Metadata = {
  title: 'SAMCO Display',
};

/**
 * ROOT LAYOUT for public display screens (queue boards, chef boards).
 *
 * Deliberately minimal and deliberately isolated: no AuthProvider, no app
 * context, no navigation, no session storage. A display device authenticates
 * to the API with its own credential and a short-lived stream ticket (T0-B);
 * a staff session cannot exist in this tree because nothing here creates one.
 *
 * Kiosk presentation: full-viewport, no chrome, large type.
 */
export default function DisplayRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={styles.body}>{children}</body>
    </html>
  );
}

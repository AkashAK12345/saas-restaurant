import type { ReactNode } from 'react';
import styles from './auth-layout.module.css';

/** Centered card, no application chrome. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>{children}</div>
    </div>
  );
}

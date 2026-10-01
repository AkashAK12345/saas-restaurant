import Link from 'next/link';
import { comingSoonEntry } from '@/lib/settings/settings-menu';
import styles from '@/components/shell/coming-soon.module.css';

/**
 * The page behind a Settings row whose screen is not built yet. It says so
 * plainly, keeps the shell around it, and offers the way back to Settings.
 * The title comes from the menu, so it always matches the row that led here.
 */
export function SettingsComingSoon({ href }: { href: string }) {
  const title = comingSoonEntry(href)?.title ?? 'This area';
  return (
    <section className={styles.page}>
      <h1>{title}</h1>
      <p className={styles.message}>{title} is not available in this version of SAMCO yet.</p>
      <Link href="/settings" className={styles.home}>
        Back to Settings
      </Link>
    </section>
  );
}

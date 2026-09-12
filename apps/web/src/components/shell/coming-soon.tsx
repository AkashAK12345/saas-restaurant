import Link from 'next/link';
import { NAV_ITEMS } from './nav-items';
import styles from './coming-soon.module.css';

/**
 * The page behind a navigation entry whose screen is not built yet.
 *
 * Navigation lists these destinations on purpose (see nav-items.ts), so they
 * must land somewhere inside the app — a bare 404 outside the shell leaves
 * the user with no way back. This says plainly that the area is not
 * available, keeps the shell around it, and offers the way home. It reads the
 * title from NAV_ITEMS so the page can never disagree with the link that led
 * here.
 */
export function ComingSoon({ href }: { href: string }) {
  const title = NAV_ITEMS.find((item) => item.href === href)?.label ?? 'This area';
  return (
    <section className={styles.page}>
      <h1>{title}</h1>
      <p className={styles.message}>{title} is not available in this version of SAMCO yet.</p>
      <Link href="/" className={styles.home}>
        Back to home
      </Link>
    </section>
  );
}

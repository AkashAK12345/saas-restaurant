import Link from 'next/link';
import { AppIcon } from '@/components/app/icons';
import styles from './inventory.module.css';

/** A tab of the inventory area whose screen is still to be built. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/inventory" className={styles.back} aria-label="Back to inventory">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </header>
      <p className={styles.soon} role="status">
        Coming soon
      </p>
    </section>
  );
}

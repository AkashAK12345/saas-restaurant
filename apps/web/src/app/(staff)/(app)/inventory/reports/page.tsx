'use client';

import Link from 'next/link';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import type { InventoryReportKey } from '@/lib/inventory/reports';
import styles from '@/components/inventory/inventory-reports.module.css';

const REPORTS: ReadonlyArray<{
  key: InventoryReportKey;
  title: string;
  sub: string;
  icon: AppIconName;
  tone: 'red' | 'green' | 'blue' | 'purple';
}> = [
  { key: 'monthly-avg', title: 'Monthly Avg Purchase', sub: 'Avg qty + price + order list per item', icon: 'barChart', tone: 'red' },
  {
    key: 'comparative',
    title: 'Comparative Purchase Analysis',
    sub: 'Period A vs Period B + per-supplier deltas',
    icon: 'transfer',
    tone: 'green',
  },
  {
    key: 'consolidated',
    title: 'Head Outlet Consolidated',
    sub: 'Items / Suppliers / Branches across all branches',
    icon: 'building',
    tone: 'blue',
  },
  { key: 'closing-stock', title: 'Closing Stock Valuation', sub: 'qty × last purchase price', icon: 'wallet', tone: 'purple' },
  { key: 'transfers', title: 'Stock Transfers', sub: 'Outlet → outlet movements from the stock ledger', icon: 'transfer', tone: 'blue' },
];

/** Inventory › Purchase Reports: the five reports, as the reference lists them. */
export default function PurchaseReportsPage() {
  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/inventory" className={styles.back} aria-label="Back to inventory">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>Purchase Reports</h1>
        </div>
      </header>
      <div className={styles.body}>
        <ul className={styles.cards} aria-label="Purchase reports">
          {REPORTS.map((r) => (
            <li key={r.key}>
              <Link href={`/inventory/reports/${r.key}`} className={styles.card}>
                <span className={styles.cardIcon} data-tone={r.tone}>
                  <AppIcon name={r.icon} size={28} />
                </span>
                <span className={styles.cardText}>
                  <span className={styles.cardTitle}>{r.title}</span>
                  <span className={styles.cardSub}>{r.sub}</span>
                </span>
                <span className={styles.cardChevron}>
                  <AppIcon name="chevronRight" size={24} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

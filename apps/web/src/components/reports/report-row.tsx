import { AppIcon, type AppIconName } from '@/components/app/icons';
import styles from './reports-sheet.module.css';

/**
 * One row of the reports list — tile, title, subtitle, chevron. The dashboard
 * sheet wraps it in a button and the Reports page in a link, so the two lists
 * look the same because they are drawn by the same code.
 */
export function ReportRowContent({ icon, title, subtitle }: { icon: AppIconName; title: string; subtitle: string }) {
  return (
    <>
      <span className={styles.tile}>
        <AppIcon name={icon} size={24} />
      </span>
      <span className={styles.text}>
        <span className={styles.itemTitle}>{title}</span>
        <span className={styles.itemSub}>{subtitle}</span>
      </span>
      <span className={styles.chevron}>
        <AppIcon name="chevronRight" />
      </span>
    </>
  );
}

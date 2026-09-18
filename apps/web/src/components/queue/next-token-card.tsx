import { AppIcon } from '@/components/app/icons';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';

/**
 * The number the next registration should receive, from the board's counter.
 * A preview: someone registering at the same moment can take it, and the
 * confirmation always shows the number actually issued.
 */
export function NextTokenCard({ number }: { number: number | null }) {
  return (
    <section className={`${chrome.card} ${screens.nextToken}`} aria-label="Next token">
      <span className={`${chrome.tile} ${chrome.tileLarge}`} data-tone="terracotta">
        <AppIcon name="ticket" size={40} />
      </span>
      <div>
        <p className={screens.nextTokenLabel}>Next Token</p>
        <p className={screens.nextTokenNumber}>{number ?? '—'}</p>
      </div>
    </section>
  );
}

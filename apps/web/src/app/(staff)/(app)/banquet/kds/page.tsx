'use client';

import { ScreenHeader } from '@/components/app/screen-header';
import chrome from '@/components/app/screen-chrome.module.css';

export default function BanquetKdsPage() {
  return (
    <>
      <ScreenHeader crumb="Banquet" title="KDS" />
      <div className={chrome.content}>
        <section className={chrome.card}>
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Kitchen Display System — coming soon.
          </p>
        </section>
      </div>
    </>
  );
}

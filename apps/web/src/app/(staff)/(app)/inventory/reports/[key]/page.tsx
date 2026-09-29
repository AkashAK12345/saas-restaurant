'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/app-context-provider';
import { inventoryReportsApi, type InventoryReportKey, type ReportOptions } from '@/lib/inventory/reports';
import { branchToday } from '@/lib/reports/format';
import { ReportFrame, reportStyles as styles } from '@/components/inventory/report-parts';
import { MonthlyAvgReport } from '@/components/inventory/reports/monthly-avg';
import { ComparativeReport } from '@/components/inventory/reports/comparative';
import { ConsolidatedReport } from '@/components/inventory/reports/consolidated';
import { ClosingStockReport } from '@/components/inventory/reports/closing-stock';
import { TransfersReport } from '@/components/inventory/reports/transfers';

const KEYS: readonly InventoryReportKey[] = ['monthly-avg', 'comparative', 'consolidated', 'closing-stock', 'transfers'];

/** One purchase report, by its key in the URL. */
export default function InventoryReportPage() {
  const { key } = useParams<{ key: string }>();
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);
  const [options, setOptions] = useState<ReportOptions | null>(null);
  // Periods follow the head office calendar.
  const today = branchToday('Asia/Kolkata');

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    inventoryReportsApi
      .options(ctx)
      .then((o) => !cancelled && setOptions(o))
      .catch(() => undefined); // The report itself says why it cannot load.
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  if (!KEYS.includes(key as InventoryReportKey)) {
    return (
      <ReportFrame title="Report">
        <p className={styles.empty}>No such report.</p>
      </ReportFrame>
    );
  }
  if (!ctx) {
    return (
      <ReportFrame title="Report">
        <p className={styles.empty}>Choose a company to see its reports.</p>
      </ReportFrame>
    );
  }
  switch (key as InventoryReportKey) {
    case 'monthly-avg':
      return <MonthlyAvgReport ctx={ctx} options={options} today={today} />;
    case 'comparative':
      return <ComparativeReport ctx={ctx} options={options} today={today} />;
    case 'consolidated':
      return <ConsolidatedReport ctx={ctx} today={today} />;
    case 'closing-stock':
      return <ClosingStockReport ctx={ctx} options={options} />;
    case 'transfers':
      return <TransfersReport ctx={ctx} options={options} today={today} />;
  }
}

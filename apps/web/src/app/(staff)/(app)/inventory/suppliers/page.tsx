'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { inventoryApi, type InventoryFilters } from '@/lib/inventory/api';
import { lastCycle, supplierLedgerApi, thisCycle, type Ledger, type LedgerQuery } from '@/lib/inventory/supplier-ledger';
import { rangeDash } from '@/lib/inventory/reports';
import { branchToday, formatMoney } from '@/lib/reports/format';
import { saveFile } from '@/lib/reports/api';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { DateDialog } from '@/components/reports/date-range-dialog';
import { SupplierLedgerCard } from '@/components/inventory/supplier-ledger-card';
import inventoryStyles from '@/components/inventory/inventory.module.css';
import styles from '@/components/inventory/supplier-ledger.module.css';

const SEARCH_DELAY_MS = 300;
type Cycle = 'this' | 'last' | 'custom';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Inventory › Suppliers — the supplier ledger for a cycle (this half-month,
 * the last, or any dates): what was bought and paid, what is still owed,
 * and each supplier's account to open, pay and send.
 */
export default function SuppliersPage() {
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);
  // Cycles follow the head office calendar.
  const today = branchToday('Asia/Kolkata');

  const [cycle, setCycle] = useState<Cycle>('this');
  const [custom, setCustom] = useState(() => thisCycle(today));
  const [picking, setPicking] = useState(false);
  const [filters, setFilters] = useState<InventoryFilters | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [reads, setReads] = useState(0);
  const [state, setState] = useState<{ key: string; data: Ledger | null; error: string | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = cycle === 'this' ? thisCycle(today) : cycle === 'last' ? lastCycle(today) : custom;
  const query: LedgerQuery = useMemo(
    () => ({ from: range.from, to: range.to, branch_id: branchId ?? undefined, q: q || undefined }),
    [range.from, range.to, branchId, q],
  );
  const key = `${JSON.stringify(query)}#${reads}`;

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    inventoryApi
      .filters(ctx)
      .then((f) => !cancelled && setFilters(f))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    supplierLedgerApi
      .ledger(ctx, query)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e) => !cancelled && setState({ key, data: null, error: e instanceof Error ? e.message : 'Could not load the ledger' }));
    return () => {
      cancelled = true;
    };
  }, [ctx, query, key]);

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.empty}>Choose a company to see its suppliers.</p>
      </section>
    );
  }

  const data = state?.data ?? null;
  const loading = state?.key !== key;
  const money = (m: number) => formatMoney(m, data?.currency ?? 'INR');
  const period = rangeDash(range.from, range.to);

  const ledgerPdf = () => supplierLedgerApi.ledgerPdf(ctx, query);

  const run = async (what: 'csv' | 'pdf' | 'share') => {
    if (!data) return;
    setBusy(true);
    try {
      if (what === 'csv') {
        const lines = [
          ['Supplier', 'Phone', 'Opening', 'Purchases', 'Paid', 'Closing'],
          ...data.suppliers.map((s) => [
            s.name,
            s.phone ?? '',
            ...[s.opening_minor, s.purchases_minor, s.paid_minor, s.closing_minor].map((m) => (m / 100).toFixed(2)),
          ]),
        ].map((row) => row.map(csvCell).join(','));
        saveFile({
          blob: new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }),
          filename: `supplier-ledger-${range.from}-to-${range.to}.csv`,
        });
      } else {
        const file = await ledgerPdf();
        const pdf = new File([file.blob], file.filename, { type: 'application/pdf' });
        if (what === 'share' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [pdf] })) {
          await navigator.share({ files: [pdf], title: `Supplier ledger ${period}` });
        } else {
          saveFile(file);
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setToast(e instanceof Error ? e.message : 'That did not work');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.page}>
      <div className={styles.top}>
        <div className={styles.topInner}>
          <div className={inventoryStyles.segment} role="tablist" aria-label="Inventory views">
            <Link href="/inventory" role="tab" aria-selected="false" className={`${inventoryStyles.segmentTab} ${styles.segmentLink}`}>
              Products
            </Link>
            <Link
              href="/inventory/suppliers"
              role="tab"
              aria-selected="true"
              className={`${inventoryStyles.segmentTab} ${styles.segmentLink}`}
            >
              Suppliers
            </Link>
          </div>

          <div className={styles.cycleRow}>
            <div className={styles.cycles} role="group" aria-label="Cycle">
              <button type="button" aria-pressed={cycle === 'this'} onClick={() => setCycle('this')}>
                This cycle
              </button>
              <button type="button" aria-pressed={cycle === 'last'} onClick={() => setCycle('last')}>
                Last cycle
              </button>
              <button type="button" aria-pressed={cycle === 'custom'} onClick={() => setPicking(true)}>
                Custom
              </button>
            </div>
            <div className={styles.tools}>
              <button type="button" className={styles.tool} data-tone="green" aria-label="Download" disabled={!data?.suppliers.length || busy} onClick={() => void run('csv')}>
                <AppIcon name="download" size={24} />
              </button>
              <button type="button" className={styles.tool} aria-label="Ledger PDF" disabled={!data?.suppliers.length || busy} onClick={() => void run('pdf')}>
                <AppIcon name="document" size={24} />
              </button>
              <button type="button" className={styles.tool} aria-label="Share" disabled={!data?.suppliers.length || busy} onClick={() => void run('share')}>
                <AppIcon name="share" size={24} />
              </button>
            </div>
          </div>
          <p className={styles.range}>{period}</p>

          <div className={styles.stats}>
            {(
              [
                ['Purchases', data?.summary.purchases_minor, 'cartPlus', 'red'],
                ['Paid', data?.summary.paid_minor, 'checkRing', 'green'],
                ['Pending', data?.summary.pending_minor, 'hourglass', 'amber'],
              ] as const
            ).map(([label, value, icon, tone]) => (
              <section key={label} className={styles.stat} aria-label={label}>
                <span className={styles.statTop}>
                  {label}
                  <span className={styles.statIcon} data-tone={tone}>
                    <AppIcon name={icon} size={22} />
                  </span>
                </span>
                <p className={styles.statValue}>{value === undefined ? '—' : money(value)}</p>
              </section>
            ))}
          </div>

          <div className={styles.filters}>
            <SearchSelect
              label="Branch"
              allLabel="All branches"
              options={(filters?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
              value={branchId}
              onChange={setBranchId}
            />
            <label className={styles.search}>
              <AppIcon name="search" size={22} />
              <span className="sr-only">Search supplier name or phone</span>
              <input type="search" placeholder="Search supplier name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          {toast ? (
            <p className={styles.toast} role="status">
              {toast}
            </p>
          ) : null}
          {state?.error ? (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      </div>

      {data?.suppliers.length ? (
        <ul className={styles.list} aria-label="Suppliers">
          {data.suppliers.map((s) => (
            <SupplierLedgerCard
              key={s.vendor_id}
              ctx={ctx}
              supplier={s}
              query={query}
              period={period}
              onChanged={(message) => {
                setToast(message);
                setReads((n) => n + 1);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{loading ? 'Loading…' : 'Nothing bought or owed in this cycle.'}</p>
      )}

      {picking ? (
        <DateDialog
          mode="range"
          initial={range}
          max={thisCycle(today).to}
          onCancel={() => setPicking(false)}
          onApply={(picked) => {
            setCustom(picked);
            setCycle('custom');
            setPicking(false);
          }}
        />
      ) : null}
    </section>
  );
}

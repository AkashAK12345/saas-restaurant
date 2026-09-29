'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth/permissions';
import {
  inventoryApi,
  type InventoryFilters,
  type InventoryItemRow,
  type InventoryOverview,
  type InventoryQuery,
} from '@/lib/inventory/api';
import { compactMoney, quantity } from '@/lib/inventory/format';
import { itemsToCsv } from '@/lib/inventory/export';
import { saveFile } from '@/lib/reports/api';
import { pillRangeLabel } from '@/lib/reports/purchase-ui';
import { branchToday } from '@/lib/reports/format';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import { DateDialog } from '@/components/reports/date-range-dialog';
import styles from '@/components/inventory/inventory.module.css';

/** Items asked for at a time; "Show more" asks for the next page. */
const PAGE = 100;
/** Typing in the search waits this long before asking the server. */
const SEARCH_DELAY_MS = 300;

/** A control drawn as the reference has it, whose screen is still to come. */
const soon = { 'aria-disabled': true, title: 'Coming soon' } as const;

/**
 * Inventory — every product, with its stock, consumption and purchases at
 * each branch the viewer may see, under the company's purchase totals.
 *
 * Filters narrow the items (category, department, search); the branch also
 * narrows the columns and the totals; the dates bound Consumed, Purchase and
 * the period totals. Everything is filtered on the SERVER, which proves
 * inventory.view at every branch it returns.
 */
export default function InventoryPage() {
  const { selectedCompanyId, companyPermissions } = useAppContext();
  // A courtesy: the server checks the right again at the outlet chosen.
  const mayPurchase = hasPermission(companyPermissions, PERMISSION_KEYS.INVENTORY_PURCHASE_CREATE);
  const mayTransfer = hasPermission(companyPermissions, PERMISSION_KEYS.INVENTORY_TRANSFER);
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);

  const [filters, setFilters] = useState<InventoryFilters | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [dialog, setDialog] = useState(false);

  const [data, setData] = useState<InventoryOverview | null>(null);
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // The search box asks the server once typing pauses, not on every key.
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
      .catch(() => undefined); // The overview reports any refusal.
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const query: InventoryQuery = useMemo(
    () => ({
      branch_id: branchId ?? undefined,
      category_id: categoryId ?? undefined,
      department: department ?? undefined,
      q: q || undefined,
      from: range?.from,
      to: range?.to,
    }),
    [branchId, categoryId, department, q, range],
  );

  const load = useCallback(
    async (offset: number) => {
      if (!ctx) return;
      setLoading(true);
      setError(null);
      try {
        const res = await inventoryApi.overview(ctx, { ...query, limit: PAGE, offset });
        setData(res);
        setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load inventory');
        if (offset === 0) {
          setData(null);
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [ctx, query],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.soon} role="status">
          Choose a company to see its inventory.
        </p>
      </section>
    );
  }

  const exportGrid = async () => {
    if (!data) return;
    setExporting(true);
    setError(null);
    try {
      // Every page, not just what is on screen.
      const all: InventoryItemRow[] = [];
      for (let offset = 0; offset < data.meta.total; offset += 200) {
        all.push(...(await inventoryApi.overview(ctx, { ...query, limit: 200, offset })).items);
      }
      const csv = itemsToCsv(data.branches, all);
      saveFile({
        blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        filename: `inventory-${branchToday('Asia/Kolkata')}.csv`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary;
  const branches = data?.branches ?? [];

  return (
    <section className={styles.page}>
      <div className={styles.segment} role="tablist" aria-label="Inventory views">
        <button type="button" role="tab" aria-selected="true" className={styles.segmentTab}>
          Products
        </button>
        <Link href="/inventory/suppliers" role="tab" aria-selected="false" className={`${styles.segmentTab} ${styles.segmentLink}`}>
          Suppliers
        </Link>
      </div>

      <header className={styles.head}>
        <Link href="/" className={styles.back} aria-label="Back">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>Inventory</h1>
        </div>
      </header>

      <div className={styles.actions}>
        {mayPurchase ? (
          <Link href="/inventory/manual-purchase" className={`${styles.action} ${styles.iconOnly}`} aria-label="Manual purchase">
            <AppIcon name="cartPlus" size={22} />
          </Link>
        ) : (
          <button type="button" className={`${styles.action} ${styles.iconOnly}`} aria-label="Manual purchase" {...soon}>
            <AppIcon name="cartPlus" size={22} />
          </button>
        )}
        {mayTransfer ? (
          <Link href="/inventory/transfer" className={styles.action}>
            <AppIcon name="transfer" size={20} />
            Transfer
          </Link>
        ) : (
          <button type="button" className={styles.action} {...soon}>
            <AppIcon name="transfer" size={20} />
            Transfer
          </button>
        )}
        <button
          type="button"
          className={`${styles.action} ${styles.iconOnly} ${styles.actionGreen}`}
          aria-label="Download"
          onClick={() => void exportGrid()}
          disabled={!data || exporting}
        >
          <AppIcon name="download" size={22} />
        </button>
        <Link href="/inventory/reports" className={styles.action}>
          <AppIcon name="barChart" size={20} />
          Reports
        </Link>
      </div>

      {summary ? (
        <dl className={styles.summary}>
          <div>
            <dt>Purchase</dt>
            <dd data-tone="red">{compactMoney(summary.purchase_minor, summary.currency)}</dd>
          </div>
          <div>
            <dt>Outstanding</dt>
            <dd data-tone="amber">
              {compactMoney(summary.outstanding_minor, summary.currency)}
              <AppIcon name="chevronRight" size={18} />
            </dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd data-tone="red">{summary.open}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd data-tone="green">{summary.received}</dd>
          </div>
        </dl>
      ) : null}

      <div className={styles.filters}>
        <SearchSelect
          label="Branch"
          allLabel="All branches"
          options={(filters?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
          value={branchId}
          onChange={setBranchId}
        />
        <SearchSelect
          label="Category"
          allLabel="All categories"
          options={(filters?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={setCategoryId}
          align="center"
        />
        <SearchSelect
          label="Department"
          allLabel="All departments"
          options={(filters?.departments ?? []).map((d) => ({ value: d, label: d }))}
          value={department}
          onChange={setDepartment}
          align="end"
        />
      </div>

      <div className={styles.searchRow}>
        <label className={styles.search}>
          <AppIcon name="search" size={22} />
          <span className="sr-only">Search items</span>
          <input type="search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="button" className={`${styles.action} ${styles.iconOnly}`} aria-label="Search every branch" {...soon}>
          <AppIcon name="globeSearch" size={24} />
        </button>
      </div>

      <div className={styles.dateRow}>
        <button type="button" className={styles.dates} onClick={() => setDialog(true)}>
          <AppIcon name="calendar" size={22} />
          {range ? pillRangeLabel(range.from, range.to) : 'Select dates'}
        </button>
        {range ? (
          <button type="button" className={styles.clearDates} aria-label="Clear dates" onClick={() => setRange(null)}>
            <AppIcon name="close" size={18} />
          </button>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <p className={styles.count}>
            <span>Items × Branches</span>
            {data.meta.total} {data.meta.total === 1 ? 'item' : 'items'}
          </p>
          {items.length === 0 ? (
            <p className={styles.empty} role="status">
              {q || categoryId || department ? 'No items match these filters' : 'No products yet'}
            </p>
          ) : (
            <div className={styles.gridWrap}>
              <table className={styles.grid}>
                <caption className="sr-only">Stock, consumption and purchases by branch</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} className={styles.itemHead}>
                      Item
                    </th>
                    {branches.map((b) => (
                      <th key={b.id} scope="colgroup" colSpan={3} className={styles.branchHead}>
                        {b.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {branches.flatMap((b) =>
                      ['Stock', 'Consumed', 'Purchase'].map((label) => (
                        <th key={`${b.id}-${label}`} scope="col" className={styles.subHead}>
                          {label}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <th scope="row" className={styles.itemCell}>
                        <span className={styles.itemName}>{item.name}</span>
                        <span className={styles.itemUnit}>{item.unit}</span>
                      </th>
                      {branches.flatMap((b) => {
                        const cell = item.cells[b.id];
                        return [
                          <td key={`${b.id}-s`}>{quantity(cell?.stock)}</td>,
                          <td key={`${b.id}-c`}>{quantity(cell?.consumed)}</td>,
                          <td key={`${b.id}-p`}>{quantity(cell?.purchase)}</td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length < data.meta.total ? (
            <button type="button" className={styles.more} onClick={() => void load(items.length)} disabled={loading}>
              {loading ? 'Loading…' : `Show more (${data.meta.total - items.length} left)`}
            </button>
          ) : null}
        </>
      ) : loading ? (
        <p className={styles.soon} role="status">
          Loading…
        </p>
      ) : null}

      {dialog ? (
        <DateDialog
          mode="range"
          initial={range ?? { from: branchToday('Asia/Kolkata'), to: branchToday('Asia/Kolkata') }}
          max={branchToday('Asia/Kolkata')}
          onCancel={() => setDialog(false)}
          onApply={(picked) => {
            setRange(picked);
            setDialog(false);
          }}
        />
      ) : null}
    </section>
  );
}

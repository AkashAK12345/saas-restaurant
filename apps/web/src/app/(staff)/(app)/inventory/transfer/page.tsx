'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { inventoryApi, type TransferOptions, type TransferStock } from '@/lib/inventory/api';
import { parseQuantity, stockFigure } from '@/lib/inventory/format';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import styles from '@/components/inventory/transfer.module.css';

/** How long a message stays at the foot of the screen. */
const SNACK_MS = 4_000;

type Tab = 'raw' | 'assets';
type Filter = 'all' | 'raw' | 'products';

/** One row of the list: a raw material with stock, or a menu product. */
interface Row {
  key: string;
  kind: 'RAW' | 'PRODUCT';
  id: string;
  name: string;
  unit: string | null;
  /** Raw materials only; products are not stock-tracked. */
  onHand: number | null;
}

/**
 * Transfer Stock — send goods from one outlet to another, landing there at
 * once. Pick the source and the destination, tick what to send, and give
 * each a quantity: raw materials no more than the source has on hand, menu
 * products (not stock-tracked) as a count on the record. The Assets tab is
 * drawn as the reference has it; its register is still to come.
 */
export default function TransferStockPage() {
  const { selectedCompanyId } = useAppContext();
  const ctx = useMemo(() => (selectedCompanyId ? { companyId: selectedCompanyId } : null), [selectedCompanyId]);

  const [tab, setTab] = useState<Tab>('raw');
  const [options, setOptions] = useState<TransferOptions | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  /** What the source holds, and which source it was read for. */
  const [held, setHeld] = useState<{ source: string | null; stock: TransferStock | null } | null>(null);
  /** Bumped to read the source again after a transfer. */
  const [reads, setReads] = useState(0);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetNote, setAssetNote] = useState('');
  /** Row key -> quantity as typed, in the order ticked. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const [snack, setSnack] = useState<string | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((message: string) => {
    setSnack(message);
    if (snackTimer.current) clearTimeout(snackTimer.current);
    snackTimer.current = setTimeout(() => setSnack(null), SNACK_MS);
  }, []);
  useEffect(
    () => () => {
      if (snackTimer.current) clearTimeout(snackTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    inventoryApi
      .transferOptions(ctx)
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        // One outlet to send from is no choice at all.
        if (opts.sources.length === 1) setSourceId(opts.sources[0].id);
      })
      .catch((e) => !cancelled && say(e instanceof Error ? e.message : 'Could not load the transfer form'));
    return () => {
      cancelled = true;
    };
  }, [ctx, say]);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    inventoryApi
      .transferStock(ctx, sourceId)
      .then((stock) => !cancelled && setHeld({ source: sourceId, stock }))
      .catch((e) => {
        if (cancelled) return;
        setHeld({ source: sourceId, stock: null });
        say(e instanceof Error ? e.message : 'Could not load what this outlet holds');
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, sourceId, reads, say]);

  // Until the new source is read, none of the old one's raw materials are
  // offered; the products are the company's, whichever outlet sends them.
  const loading = held?.source !== sourceId;
  const stock = useMemo<TransferStock | null>(() => {
    if (!held?.stock) return null;
    return loading ? { raw_materials: [], products: held.stock.products } : held.stock;
  }, [held, loading]);

  const rows = useMemo<Row[]>(() => {
    if (!stock) return [];
    return [
      ...stock.raw_materials.map((r) => ({
        key: `RAW:${r.id}`,
        kind: 'RAW' as const,
        id: r.id,
        name: r.name,
        unit: r.unit,
        onHand: r.on_hand,
      })),
      ...stock.products.map((p) => ({
        key: `PRODUCT:${p.id}`,
        kind: 'PRODUCT' as const,
        id: p.id,
        name: p.name,
        unit: p.unit,
        onHand: null,
      })),
    ];
  }, [stock]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  if (!ctx) {
    return (
      <section className={styles.page}>
        <p className={styles.note}>Choose a company to transfer stock.</p>
      </section>
    );
  }

  const chooseSource = (id: string | null) => {
    setSourceId(id);
    if (id && id === destinationId) setDestinationId(null);
    // Raw materials belong to the outlet they were ticked at.
    setPicked((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('RAW:'))));
  };

  const toggle = (key: string) =>
    setPicked((prev) => {
      if (!(key in prev)) return { ...prev, [key]: '' };
      return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key));
    });

  const q = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || (filter === 'raw' ? r.kind === 'RAW' : r.kind === 'PRODUCT')) &&
      (!q || r.name.toLowerCase().includes(q)),
  );
  const count = tab === 'raw' ? Object.keys(picked).length : 0;

  const emptyText = (() => {
    if (loading) return 'Loading…';
    if (q) return `Nothing matches “${search.trim()}”.`;
    if (filter === 'raw' || (filter === 'all' && !stock?.products.length)) {
      return sourceId ? 'No raw materials with stock at this outlet.' : 'Select a source outlet to see its raw materials.';
    }
    return 'No menu products yet.';
  })();

  const transfer = async () => {
    if (!sourceId || !destinationId) return say('Select where to send from and where to send to');
    const lines = Object.entries(picked).map(([key, typed]) => ({ row: byKey.get(key), typed }));
    if (lines.some((l) => !l.row || parseQuantity(l.typed) === null)) {
      return say('Enter quantities for the selected items');
    }
    for (const { row, typed } of lines) {
      if (row!.onHand !== null && parseQuantity(typed)! > row!.onHand) {
        return say(`Only ${stockFigure(row!.onHand)} ${row!.unit} of ${row!.name} on hand`);
      }
    }
    setSending(true);
    try {
      const done = await inventoryApi.recordTransfer(ctx, {
        from_branch_id: sourceId,
        to_branch_id: destinationId,
        lines: lines.map(({ row, typed }) => ({ kind: row!.kind, id: row!.id, quantity: parseQuantity(typed)! })),
      });
      setPicked({});
      say(`Transferred ${done.items} ${done.items === 1 ? 'item' : 'items'} to ${done.to} (${done.number})`);
      setReads((n) => n + 1);
    } catch (e) {
      say(`Failed: ${e instanceof Error ? e.message : 'the transfer was not saved'}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <Link href="/inventory" className={styles.back} aria-label="Back to inventory">
          <AppIcon name="back" size={22} />
        </Link>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h1 className={styles.title}>Transfer Stock</h1>
        </div>
      </header>

      <div className={styles.controls}>
        <div className={styles.controlsInner}>
          <div className={styles.segment} role="tablist" aria-label="What to transfer">
            {(
              [
                ['raw', 'Raw materials'],
                ['assets', 'Assets'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={styles.segmentTab}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.pickers}>
            <div className={styles.picker}>
              <span className={styles.pickerLabel} aria-hidden="true">
                From outlet
              </span>
              <SearchSelect
                label="From outlet"
                placeholder="Select source"
                options={(options?.sources ?? []).map((b) => ({ value: b.id, label: b.name }))}
                value={sourceId}
                onChange={chooseSource}
              />
            </div>
            <div className={styles.picker}>
              <span className={styles.pickerLabel} aria-hidden="true">
                Send to
              </span>
              <SearchSelect
                label="Send to"
                placeholder="Select destination"
                options={(options?.destinations ?? [])
                  .filter((b) => b.id !== sourceId)
                  .map((b) => ({ value: b.id, label: b.name }))}
                value={destinationId}
                onChange={setDestinationId}
                align="end"
              />
            </div>
          </div>

          {tab === 'raw' ? (
            <>
              <label className={styles.field}>
                <AppIcon name="search" size={22} />
                <span className="sr-only">Search items</span>
                <input type="search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <div className={styles.chips} role="group" aria-label="Show">
                {(
                  [
                    ['all', 'All'],
                    ['raw', 'Raw materials'],
                    ['products', 'Products'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.chip}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className={styles.field}>
                <AppIcon name="search" size={22} />
                <span className="sr-only">Search assets</span>
                <input
                  type="search"
                  placeholder="Search assets"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <AppIcon name="notes" size={22} />
                <span className="sr-only">Note (required)</span>
                <input
                  placeholder="Note (required) — reason / reference"
                  value={assetNote}
                  maxLength={500}
                  onChange={(e) => setAssetNote(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
      </div>

      {tab === 'raw' ? (
        shown.length === 0 ? (
          <p className={styles.empty}>{emptyText}</p>
        ) : (
          <ul className={styles.list} aria-label="Items to transfer">
            {shown.map((row) => {
              const selected = row.key in picked;
              const typed = picked[row.key] ?? '';
              return (
                <li key={row.key} className={styles.row} data-selected={selected}>
                  <label className={styles.pick}>
                    <input type="checkbox" checked={selected} onChange={() => toggle(row.key)} />
                    <span className={styles.box} aria-hidden="true">
                      {selected ? <AppIcon name="check" size={18} /> : null}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.name}>
                        {row.name}
                        {row.kind === 'PRODUCT' ? <span className={styles.badge}>Product</span> : null}
                      </span>
                      <span className={styles.sub}>
                        {row.onHand !== null
                          ? `On hand: ${stockFigure(row.onHand)} ${row.unit}`
                          : 'Menu product · not stock-tracked'}
                      </span>
                    </span>
                  </label>
                  {selected ? (
                    <span className={styles.qty}>
                      <input
                        inputMode="decimal"
                        placeholder="Qty"
                        aria-label={`Quantity of ${row.name}`}
                        value={typed}
                        // Just ticked: type the quantity straight away.
                        autoFocus
                        aria-invalid={
                          typed !== '' &&
                          (parseQuantity(typed) === null || (row.onHand !== null && parseQuantity(typed)! > row.onHand))
                        }
                        onChange={(e) => setPicked((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      />
                      {row.unit ? <span>{row.unit}</span> : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <p className={styles.empty}>
          {sourceId ? 'No assets with available units at this outlet.' : 'Select a source outlet to see its assets.'}
        </p>
      )}

      <div className={styles.bottom}>
        {snack ? (
          <p className={styles.snack} role="status">
            {snack}
          </p>
        ) : null}
        <footer className={styles.foot}>
          <Link href="/inventory" className={styles.cancel}>
            Cancel
          </Link>
          <button
            type="button"
            className={styles.send}
            disabled={count === 0 || sending}
            onClick={() => void transfer()}
          >
            {sending ? 'Transferring…' : `Transfer (${count})`}
          </button>
        </footer>
      </div>
    </section>
  );
}

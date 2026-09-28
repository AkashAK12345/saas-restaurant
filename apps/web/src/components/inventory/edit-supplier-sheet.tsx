'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import { SearchSelect } from '@/components/app/search-select';
import {
  inventoryApi,
  type InventoryContext,
  type SupplierDetail,
  type SupplierPatch,
  type SupplierRef,
} from '@/lib/inventory/api';
import { purchaseOrdersApi, type OrderDetail } from '@/lib/inventory/purchase-orders';
import { CreateSupplierSheet } from './create-supplier-sheet';
import styles from './create-supplier.module.css';

type Field = keyof SupplierPatch;

const MAIN: ReadonlyArray<{ key: Field; label: string; inputMode?: 'tel' | 'numeric' }> = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone', inputMode: 'tel' },
  { key: 'gstin', label: 'GSTIN' },
];
const BANK: ReadonlyArray<{ key: Field; label: string; inputMode?: 'tel' | 'numeric' }> = [
  { key: 'bank_account_name', label: 'Account holder name' },
  { key: 'bank_account_number', label: 'Account number', inputMode: 'numeric' },
  { key: 'bank_ifsc', label: 'IFSC code' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'bank_branch', label: 'Bank branch' },
  { key: 'upi_id', label: 'UPI ID' },
];
const FIELDS = [...MAIN, ...BANK].map((f) => f.key);

type Form = Record<Field, string>;

function formOf(s: SupplierDetail): Form {
  return Object.fromEntries(FIELDS.map((k) => [k, (s[k] as string | null) ?? ''])) as Form;
}

/**
 * "Edit Supplier" — from an order's pencil, as the reference has it: switch
 * the order to another supplier (or create one), and edit the details of the
 * one it will have. Switching needs the right to change the order; editing
 * details needs the right to manage suppliers. Save does both.
 */
export function EditSupplierSheet({
  ctx,
  order,
  onClose,
  onSaved,
}: {
  ctx: InventoryContext;
  order: OrderDetail;
  onClose: () => void;
  onSaved: (order: OrderDetail) => void;
}) {
  const canSwitch = order.may_edit;
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([]);
  const [pickedId, setPickedId] = useState(order.vendor.id);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [bankOpen, setBankOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canSwitch) return;
    let cancelled = false;
    inventoryApi
      .suppliers(ctx)
      .then((s) => !cancelled && setSuppliers(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx, canSwitch]);

  // The details shown are those of the supplier the order will have.
  useEffect(() => {
    let cancelled = false;
    inventoryApi
      .supplier(ctx, pickedId)
      .then((s) => {
        if (cancelled) return;
        setDetail(s);
        setForm(formOf(s));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the supplier'));
    return () => {
      cancelled = true;
    };
  }, [ctx, pickedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !creating && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, creating]);

  const loaded = !!detail && !!form && detail.id === pickedId;
  const changes = useMemo(() => {
    if (!detail || !form) return {};
    const was = formOf(detail);
    return Object.fromEntries(FIELDS.filter((k) => form[k].trim() !== was[k]).map((k) => [k, form[k].trim()])) as SupplierPatch;
  }, [detail, form]);
  const edited = Object.keys(changes).length > 0;
  const switched = pickedId !== order.vendor.id;
  const valid = !form || (form.name.trim() !== '' && form.phone.trim() !== '');
  const ready = loaded && (edited || switched) && valid && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (edited) await inventoryApi.updateSupplier(ctx, pickedId, changes);
      const next = switched
        ? await purchaseOrdersApi.update(ctx, order.id, { vendor_id: pickedId })
        : await purchaseOrdersApi.get(ctx, order.id);
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the supplier');
      setSaving(false);
    }
  };

  const input = (f: { key: Field; label: string; inputMode?: 'tel' | 'numeric' }) => {
    const value = form?.[f.key] ?? '';
    return (
      <label key={f.key} className={`${styles.field} ${styles.labelled}`}>
        {value ? (
          <span className={styles.tag} aria-hidden="true">
            {f.label}
          </span>
        ) : null}
        <input
          aria-label={f.label}
          placeholder={f.label}
          value={value}
          inputMode={f.inputMode}
          autoComplete="off"
          readOnly={!detail?.may_edit}
          onChange={(e) => setForm((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
        />
      </label>
    );
  };

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="edit-supplier-title">
      <header className={styles.head}>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <AppIcon name="close" size={26} />
        </button>
        <h2 className={styles.title} id="edit-supplier-title">
          Edit Supplier
        </h2>
      </header>

      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save();
        }}
      >
        {canSwitch ? (
          <>
            <p className={styles.section}>Switch supplier</p>
            <p className={styles.current}>Current: {order.vendor.name}</p>
            <SearchSelect
              label="Switch supplier"
              placeholder="Pick another supplier"
              options={suppliers.filter((s) => s.id !== order.vendor.id).map((s) => ({ value: s.id, label: s.name, hint: s.label }))}
              value={switched ? pickedId : null}
              onChange={(v) => setPickedId(v ?? order.vendor.id)}
            />
            <button type="button" className={styles.createLink} onClick={() => setCreating(true)}>
              <AppIcon name="plusCircle" size={24} />+ Create new supplier
            </button>
          </>
        ) : null}

        <p className={styles.section}>{switched ? 'Edit new supplier' : 'Edit current supplier'}</p>
        {loaded ? (
          <>
            {MAIN.map(input)}
            <button type="button" className={styles.fold} aria-expanded={bankOpen} onClick={() => setBankOpen((o) => !o)}>
              <span>Bank details (optional)</span>
              <AppIcon name={bankOpen ? 'chevronUp' : 'chevronDown'} size={22} />
            </button>
            {bankOpen ? <div className={styles.bank}>{BANK.map(input)}</div> : null}
            {!detail.may_edit ? (
              <p className={styles.current}>You can switch the supplier, but not change its details.</p>
            ) : null}
          </>
        ) : (
          <p className={styles.current}>Loading…</p>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <footer className={styles.foot}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.save} disabled={!ready}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>

      {creating ? (
        <CreateSupplierSheet
          ctx={ctx}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
            setPickedId(s.id);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

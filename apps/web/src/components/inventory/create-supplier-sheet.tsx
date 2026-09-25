'use client';

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import { inventoryApi, type InventoryContext, type SupplierRef } from '@/lib/inventory/api';
import styles from './create-supplier.module.css';

/**
 * "Create supplier" — a full-screen form over the purchase, as the reference
 * has it: name and contact number, then GST and address (optional), then
 * bank details folded away (optional). Save is off until the two required
 * fields are filled; the server checks the rest and says what is wrong.
 */
export function CreateSupplierSheet({
  ctx,
  onCreated,
  onClose,
}: {
  ctx: InventoryContext;
  onCreated: (supplier: SupplierRef) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [bankOpen, setBankOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = name.trim() !== '' && phone.trim() !== '' && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const optional = (v: string) => v.trim() || undefined;
      const created = await inventoryApi.createSupplier(ctx, {
        name: name.trim(),
        phone: phone.trim(),
        gstin: optional(gstin),
        address: optional(address),
        bank_account_name: optional(accountName),
        bank_account_number: optional(accountNumber),
        bank_ifsc: optional(ifsc),
        bank_name: optional(bankName),
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the supplier');
      setSaving(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    extra: { ref?: React.Ref<HTMLInputElement>; inputMode?: 'tel' | 'text' | 'numeric'; autoComplete?: string } = {},
  ) => (
    <label className={styles.field}>
      <span className="sr-only">{label}</span>
      <input
        ref={extra.ref}
        placeholder={label}
        value={value}
        inputMode={extra.inputMode}
        autoComplete={extra.autoComplete ?? 'off'}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="create-supplier-title">
      <header className={styles.head}>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <AppIcon name="close" size={26} />
        </button>
        <h2 className={styles.title} id="create-supplier-title">
          Create supplier
        </h2>
      </header>

      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save();
        }}
      >
        {field('Name', name, setName, { ref: first })}
        {field('Contact number', phone, setPhone, { inputMode: 'tel', autoComplete: 'tel' })}
        {field('GST (optional)', gstin, setGstin)}
        <label className={styles.field}>
          <span className="sr-only">Address (optional)</span>
          <textarea placeholder="Address (optional)" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>

        <button
          type="button"
          className={styles.fold}
          aria-expanded={bankOpen}
          onClick={() => setBankOpen((o) => !o)}
        >
          <AppIcon name="bank" size={26} />
          <span>Bank details (optional)</span>
          <AppIcon name={bankOpen ? 'chevronUp' : 'chevronDown'} size={22} />
        </button>
        {bankOpen ? (
          <div className={styles.bank}>
            {field('Account holder name', accountName, setAccountName)}
            {field('Account number', accountNumber, setAccountNumber, { inputMode: 'numeric' })}
            {field('IFSC', ifsc, setIfsc)}
            {field('Bank name', bankName, setBankName)}
          </div>
        ) : null}

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
    </div>
  );
}

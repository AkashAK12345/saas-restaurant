'use client';

import { useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi, type QueueContext } from '@/lib/queue/api';
import type { Customer, QueueToken } from '@/lib/queue/types';
import { branchLocalToInstant, instantToBranchLocal } from '@/lib/queue/branch-time';
import { PartyFields, type PartyValue } from './party-fields';
import { AppIcon } from '@/components/app/icons';
import chrome from '@/components/app/screen-chrome.module.css';
import screens from '@/components/app/screen-widgets.module.css';

const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

/**
 * Same number, allowing for a country code on one side only: the shorter must
 * still be a full local number (10 digits) for a suffix match to count.
 */
function samePhone(stored: string | null, typedDigits: string): boolean {
  const s = digitsOf(stored);
  if (!s || !typedDigits) return false;
  if (s === typedDigits) return true;
  const [short, long] = s.length < typedDigits.length ? [s, typedDigits] : [typedDigits, s];
  return short.length >= 10 && long.endsWith(short);
}

/**
 * Registering a party: customer name, phone number, adults and kids.
 *
 * Name and phone are optional — an empty form is a walk-in. A phone that
 * matches an existing customer reuses that record; otherwise a typed name
 * creates one. Both steps are the company's own customer API, so each needs
 * its permission and the server re-checks it. The party total is never sent:
 * the server derives it from adults and kids.
 */
export function RegisterForm({
  ctx,
  timezone,
  allowAdvance,
  submitLabel,
  onRegistered,
}: {
  ctx: QueueContext;
  timezone: string;
  /** The podium can hold a table for later today; self check-in cannot. */
  allowAdvance: boolean;
  submitLabel: string;
  onRegistered?: (token: QueueToken) => void;
}) {
  const { companyPermissions } = useAppContext();
  const mayLookup = hasPermission(companyPermissions, 'customers.view');
  const mayCreate = hasPermission(companyPermissions, 'customers.create');
  const mayUpdate = hasPermission(companyPermissions, 'customers.update');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState<PartyValue>({ adults: 2, kids: 0 });
  const [advanceLocal, setAdvanceLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<QueueToken | null>(null);
  // A customer created on an attempt whose registration then failed: a retry
  // with the same details links it instead of creating a duplicate.
  const [created, setCreated] = useState<{ key: string; customer: Customer } | null>(null);

  const reset = () => {
    setIssued(null);
    setError(null);
    setName('');
    setPhone('');
    setParty({ adults: 2, kids: 0 });
    setAdvanceLocal('');
    setCreated(null);
  };

  const resolveCustomer = async (): Promise<string | undefined> => {
    const typedName = name.trim();
    const typedPhone = phone.trim();
    const digits = digitsOf(typedPhone);
    if (!typedName && !typedPhone) return undefined;
    if (typedPhone && digits.length < 3) throw new Error('Enter a valid phone number, or leave it empty.');

    const key = `${typedName} ${digits}`;
    if (created?.key === key) return created.customer.id;

    if (digits && mayLookup) {
      const found = await queueApi.findCustomers(ctx, digits);
      const match = found.data.find((c) => c.status === 'ACTIVE' && samePhone(c.phone, digits));
      if (match) {
        // Matched by phone, but the operator may have typed a corrected or
        // updated name — keep the shared customer record in sync with it
        // rather than silently keeping whatever name was on file.
        if (typedName && match.name !== typedName && mayUpdate) {
          try {
            await queueApi.updateCustomer(ctx, match.id, { name: typedName });
          } catch {
            // Best effort — registration still proceeds under the existing record.
          }
        }
        return match.id;
      }
    }
    if (!typedName) throw new Error('Enter the customer’s name to save a new phone number.');
    if (!mayCreate) {
      throw new Error('You cannot add customers here. Clear the name and phone to register a walk-in.');
    }
    const customer = await queueApi.createCustomer(
      ctx,
      typedPhone ? { name: typedName, phone: typedPhone } : { name: typedName },
    );
    setCreated({ key, customer });
    return customer.id;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let advanceBookingAt: string | undefined;
      if (allowAdvance && advanceLocal) {
        // Interpreted in the branch's timezone, never the device's.
        const instant = branchLocalToInstant(advanceLocal, timezone);
        if (!instant) throw new Error('That booking time is not a valid date and time.');
        if (instant.getTime() <= Date.now()) throw new Error('An advance booking must be in the future.');
        // A token belongs to one service day; the server enforces the same rule.
        if (advanceLocal.slice(0, 10) !== instantToBranchLocal(new Date(), timezone).slice(0, 10)) {
          throw new Error('An advance booking must be for later today at this branch.');
        }
        advanceBookingAt = instant.toISOString();
      }

      const customerId = await resolveCustomer();
      const token = await queueApi.register(ctx, {
        adults: party.adults,
        ...(party.kids > 0 ? { kids: party.kids } : {}),
        ...(advanceBookingAt ? { advance_booking_at: advanceBookingAt } : {}),
        ...(customerId ? { customer_id: customerId } : {}),
      });
      setIssued(token);
      onRegistered?.(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register this party');
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    const kids = issued.kids > 0
      ? ` (${issued.adults} ${issued.adults === 1 ? 'adult' : 'adults'}, ${issued.kids} ${issued.kids === 1 ? 'kid' : 'kids'})`
      : '';
    return (
      <section className={`${chrome.card} ${screens.success}`} role="status" aria-live="polite">
        <h2 className={screens.successTitle}>Added to the queue</h2>
        <span className={screens.successNumber} aria-label={`Token ${issued.token_number}`}>
          {issued.token_number}
        </span>
        <p className={screens.successText}>
          {issued.customer?.name ?? 'Walk-in'} · {issued.party_size} {issued.party_size === 1 ? 'guest' : 'guests'}
          {kids}
          {issued.advance_booking_at ? ' · scheduled' : ''}
        </p>
        <button type="button" className={`${screens.button} ${screens.primary} ${screens.block}`} onClick={reset}>
          Register another
        </button>
      </section>
    );
  }

  return (
    <form
      className={`${chrome.card} ${screens.form}`}
      aria-label="Register customer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <p role="alert" className={chrome.alert}>
          {error}
        </p>
      ) : null}

      {mayCreate ? (
        <div className={screens.field}>
          <label className={screens.label} htmlFor="register-name">
            Customer Name <span className={screens.optional}>(optional)</span>
          </label>
          <input
            id="register-name"
            className={screens.input}
            placeholder="Enter customer name"
            value={name}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      ) : null}

      {mayCreate || mayLookup ? (
        <div className={screens.field}>
          <label className={screens.label} htmlFor="register-phone">
            Phone Number <span className={screens.optional}>(optional)</span>
          </label>
          <input
            id="register-phone"
            className={screens.input}
            type="tel"
            inputMode="tel"
            placeholder="Enter phone number"
            value={phone}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      ) : null}

      <PartyFields value={party} onChange={setParty} disabled={busy} />

      {allowAdvance ? (
        <div className={screens.field}>
          <label className={screens.label} htmlFor="advance-booking">
            Advance booking time <span className={screens.optional}>(optional)</span>
          </label>
          <input
            id="advance-booking"
            className={screens.input}
            type="datetime-local"
            value={advanceLocal}
            disabled={busy}
            onChange={(e) => setAdvanceLocal(e.target.value)}
          />
          <p className={screens.hint}>
            Leave empty to join the queue now. A booking for later today joins the waiting list at its time.
            Times are {timezone}.
          </p>
        </div>
      ) : null}

      <button type="submit" className={`${screens.button} ${screens.primary} ${screens.block}`} disabled={busy}>
        <AppIcon name="personAdd" size={22} />
        {busy ? 'Registering…' : submitLabel}
      </button>
    </form>
  );
}

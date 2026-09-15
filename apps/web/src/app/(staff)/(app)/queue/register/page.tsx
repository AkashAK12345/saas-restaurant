'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { queueApi } from '@/lib/queue/api';
import type { Customer, QueueToken } from '@/lib/queue/types';
import { PartyFields, type PartyValue } from '@/components/queue/party-fields';
import { branchLocalToInstant, instantToBranchLocal } from '@/lib/queue/branch-time';
import styles from './register.module.css';

type Mode = 'walkin' | 'existing' | 'new';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'walkin', label: 'Walk-in' },
  { id: 'existing', label: 'Existing customer' },
  { id: 'new', label: 'New customer' },
];

/**
 * Customer Register — the counter workflow.
 *
 * The fast path is the default: choose a party size, press one button, read
 * the token number aloud. A customer record is entirely optional (the backend
 * accepts anonymous walk-ins and never requires a phone), and a new record is
 * only ever created when the operator explicitly asks for one — nothing is
 * created implicitly behind a queue registration.
 *
 * Deliberately not a CRM: no addresses, no notes, no history editing. Looking
 * a customer up filters the company's list client-side because the API has no
 * search parameter yet; that is fine at counter scale and is noted as backlog
 * rather than worked around with a new endpoint.
 */
export default function RegisterPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, companyPermissions, branchPermissions } =
    useAppContext();
  // The branch's own zone, so a booking time means what the host typed.
  const timezone = selectedBranch?.timezone ?? 'UTC';
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );

  const mayRegister = hasPermission(branchPermissions, 'queue.register');
  const mayViewCustomers = hasPermission(companyPermissions, 'customers.view');
  const mayCreateCustomers = hasPermission(companyPermissions, 'customers.create');

  const [mode, setMode] = useState<Mode>('walkin');
  const [party, setParty] = useState<PartyValue>({ adults: 2, kids: 0 });
  // A wall clock, read in the BRANCH's zone when it is sent. Empty means the
  // party is joining the live queue now, which is the common case.
  const [advanceLocal, setAdvanceLocal] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<QueueToken | null>(null);

  // Load the customer list lazily — only when the operator needs to look one up.
  useEffect(() => {
    if (mode !== 'existing' || !ctx || !mayViewCustomers || customers.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await queueApi.customers(ctx);
        if (!cancelled) setCustomers(page.data.filter((c) => c.status === 'ACTIVE'));
      } catch {
        if (!cancelled) setError('Could not load customers. You can still register a walk-in.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, ctx, mayViewCustomers, customers.length]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = q
      ? customers.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
        )
      : customers;
    return pool.slice(0, 25);
  }, [customers, search]);

  const selected = customers.find((c) => c.id === customerId) ?? null;

  // Plain event handlers: the React Compiler memoizes these, and a manual
  // useCallback around a multi-setState reset defeats it.
  const reset = () => {
    setIssued(null);
    setError(null);
    setParty({ adults: 2, kids: 0 });
    setAdvanceLocal('');
    setCustomerId(null);
    setSearch('');
    setNewName('');
    setNewPhone('');
    setMode('walkin');
  };

  const submit = async () => {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      let linkedCustomerId: string | undefined;

      if (mode === 'existing') {
        if (!customerId) throw new Error('Choose a customer, or register a walk-in.');
        linkedCustomerId = customerId;
      } else if (mode === 'new') {
        const name = newName.trim();
        if (!name) throw new Error('Enter a name, or register a walk-in.');
        const phone = newPhone.trim();
        const created = await queueApi.createCustomer(ctx, phone ? { name, phone } : { name });
        linkedCustomerId = created.id;
        setCustomers((list) => [created, ...list]);
      }

      let advanceBookingAt: string | undefined;
      if (advanceLocal) {
        // Interpreted in the branch's timezone, never the device's.
        const instant = branchLocalToInstant(advanceLocal, timezone);
        if (!instant) throw new Error('That booking time is not a valid date and time.');
        if (instant.getTime() <= Date.now()) {
          throw new Error('An advance booking must be in the future.');
        }
        // A token belongs to one service day: a later day's booking is taken
        // on that day. The server enforces the same rule.
        if (advanceLocal.slice(0, 10) !== instantToBranchLocal(new Date(), timezone).slice(0, 10)) {
          throw new Error('An advance booking must be for later today at this branch.');
        }
        advanceBookingAt = instant.toISOString();
      }

      const token = await queueApi.register(ctx, {
        adults: party.adults,
        ...(party.kids > 0 ? { kids: party.kids } : {}),
        ...(advanceBookingAt ? { advance_booking_at: advanceBookingAt } : {}),
        ...(linkedCustomerId ? { customer_id: linkedCustomerId } : {}),
      });
      setIssued(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this party to the queue');
    } finally {
      setBusy(false);
    }
  };

  if (!mayRegister) {
    return <p className={styles.error}>You do not have permission to register parties at this branch.</p>;
  }

  if (issued) {
    return (
      <div className={styles.success} role="status" aria-live="polite">
        <h1>Added to the queue</h1>
        <span className={styles.successNumber}>{issued.token_number}</span>
        <p>
          {issued.customer?.name ?? 'Walk-in'} · {issued.party_size}{' '}
          {issued.party_size === 1 ? 'guest' : 'guests'}
          {issued.kids > 0
            ? ` (${issued.adults} ${issued.adults === 1 ? 'adult' : 'adults'}, ${issued.kids} ${issued.kids === 1 ? 'kid' : 'kids'})`
            : ''}
        </p>
        <button type="button" className={styles.submit} onClick={reset}>
          Register another party
        </button>
      </div>
    );
  }

  const availableModes = MODES.filter(
    (m) =>
      m.id === 'walkin' ||
      (m.id === 'existing' && mayViewCustomers) ||
      (m.id === 'new' && mayCreateCustomers),
  );

  return (
    <>
      <h1>Register a party</h1>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? (
          <div role="alert" className={styles.error}>
            {error}
          </div>
        ) : null}

        <PartyFields value={party} onChange={setParty} disabled={busy} />

        <div className={styles.advance}>
          <label className={styles.advanceLabel} htmlFor="advance-booking">
            Advance booking time <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="advance-booking"
            className={styles.advanceInput}
            type="datetime-local"
            value={advanceLocal}
            disabled={busy}
            onChange={(event) => setAdvanceLocal(event.target.value)}
          />
          <p className={styles.advanceHint}>
            Leave empty to join the queue now. A booking for later today is held as scheduled and
            joins the waiting list at its time. Times are {timezone}.
          </p>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Customer (optional)</legend>
          <div className={styles.modes} role="group" aria-label="Customer type">
            {availableModes.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`${styles.mode} ${mode === m.id ? styles.modeActive : ''}`}
                aria-pressed={mode === m.id}
                onClick={() => {
                  setMode(m.id);
                  setError(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'walkin' ? (
            <p className={styles.hint}>No details needed — a token is issued straight away.</p>
          ) : null}

          {mode === 'existing' ? (
            <div className={styles.row} style={{ marginTop: 'var(--gap)' }}>
              <label className={styles.label} htmlFor="customer-search">
                Find a customer
              </label>
              <input
                id="customer-search"
                className={styles.input}
                type="search"
                placeholder="Name or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              {selected ? (
                <p className={styles.hint}>Selected: {selected.name}</p>
              ) : (
                <p className={styles.hint}>Choose a customer from the list.</p>
              )}
              <ul className={styles.results}>
                {matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`${styles.result} ${customerId === c.id ? styles.resultActive : ''}`}
                      aria-pressed={customerId === c.id}
                      onClick={() => setCustomerId(customerId === c.id ? null : c.id)}
                    >
                      <span>{c.name}</span>
                      {c.phone ? <span className={styles.resultPhone}>{c.phone}</span> : null}
                    </button>
                  </li>
                ))}
                {matches.length === 0 ? <li className={styles.hint}>No matches.</li> : null}
              </ul>
            </div>
          ) : null}

          {mode === 'new' ? (
            <div className={styles.row} style={{ marginTop: 'var(--gap)' }}>
              <div>
                <label className={styles.label} htmlFor="new-name">
                  Name
                </label>
                <input
                  id="new-name"
                  className={styles.input}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={styles.label} htmlFor="new-phone">
                  Phone (optional)
                </label>
                <input
                  id="new-phone"
                  className={styles.input}
                  type="tel"
                  inputMode="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  autoComplete="off"
                />
                <p className={styles.hint}>A phone is never required to join the queue.</p>
              </div>
            </div>
          ) : null}
        </fieldset>

        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? 'Adding…' : 'Add to queue'}
        </button>
      </form>
    </>
  );
}

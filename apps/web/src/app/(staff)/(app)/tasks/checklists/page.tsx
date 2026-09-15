'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { tasksApi } from '@/lib/tasks/api';
import type { ChecklistItemKind, ChecklistTemplate, ReferenceChecklist } from '@/lib/tasks/types';

const KIND_LABEL: Record<ChecklistItemKind, string> = {
  CHECK: 'Tick',
  NUMBER: 'Number',
  TEXT: 'Text',
  RATING: 'Rating 1–5',
  DATE: 'Date',
};
import styles from '@/components/tasks/tasks.module.css';

/**
 * Checklist templates — the company's reusable definitions.
 *
 * Editing one never changes a task that already exists: every task carries its
 * own copy, so history stays truthful. The UI says so, because it is the kind
 * of thing an operator would otherwise reasonably fear.
 */
export default function ChecklistsPage() {
  const { selectedCompanyId, selectedBranchId, companyPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayManage = hasPermission(companyPermissions, 'tasks.checklist.manage');

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The empty state is a claim that there is nothing to show; it may only be
  // made once a list has actually loaded, never after a refused or failed load.
  const [listed, setListed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [library, setLibrary] = useState<ReferenceChecklist[]>([]);

  // The reference library: starter definitions for the reference routines.
  // Loaded alongside the list, and again after any change so "installed" is true.
  const loadLibrary = useCallback(async () => {
    if (!ctx) return;
    try {
      const next = await tasksApi.referenceLibrary(ctx);
      if (Array.isArray(next)) setLibrary(next);
    } catch {
      // The library is optional help; the checklists list above still works.
    }
  }, [ctx]);

  useEffect(() => {
    void (async () => {
      await loadLibrary();
    })();
  }, [loadLibrary]);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    try {
      setTemplates((await tasksApi.listChecklists(ctx)).data);
      setListed(true);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load checklists');
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The action failed');
    } finally {
      await refresh();
      await loadLibrary();
      setBusy(false);
    }
  };

  /**
   * One item per line. A line ending in "?" is optional; everything else is
   * required. A leading [number], [text], [rating] or [date] makes the item
   * ask for that kind of answer instead of a tick.
   */
  const parsedItems = itemsText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const typed = /^\[(number|text|rating|date)\]\s*/i.exec(raw);
      const kind = typed ? (typed[1].toUpperCase() as ChecklistItemKind) : ('CHECK' as const);
      const line = typed ? raw.slice(typed[0].length) : raw;
      return line.endsWith('?')
        ? { label: line.slice(0, -1).trim(), is_required: false, kind }
        : { label: line, is_required: true, kind };
    })
    .filter((i) => i.label.length > 0);

  if (loading) {
    return (
      <p role="status" aria-live="polite">
        Loading checklists…
      </p>
    );
  }

  return (
    <>
      <h1>Checklists</h1>

      {actionError ? (
        <div role="alert" className={styles.error}>
          {actionError}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className={styles.error}>
          {loadError}
        </div>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      {mayManage ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await tasksApi.createChecklist(ctx!, { name: name.trim(), items: parsedItems });
              setName('');
              setItemsText('');
            }, 'Checklist created.');
          }}
        >
          <div>
            <label className={styles.label} htmlFor="c-name">
              Checklist name
            </label>
            <input
              id="c-name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={styles.label} htmlFor="c-items">
              Items, one per line
            </label>
            <textarea
              id="c-items"
              className={styles.textarea}
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
            />
            <p className={styles.hint}>
              End a line with “?” to make that item optional. Start a line with [number], [text], [rating] or
              [date] to ask for that answer instead of a tick — e.g. “[number] Electricity meter reading”.
              Required items must be ticked or answered before a task can be completed.
            </p>
          </div>
          <div className={styles.actions}>
            <button
              type="submit"
              className={`${styles.action} ${styles.primary}`}
              disabled={busy || !name.trim() || parsedItems.length === 0}
            >
              Create checklist
            </button>
          </div>
        </form>
      ) : null}

      {mayManage && library.length > 0 ? (
        <section className={styles.panel} aria-labelledby="library-title">
          <h2 className={styles.panelTitle} id="library-title">
            Reference routines
          </h2>
          <p className={styles.hint}>
            Starter checklists for the standard daily routines. Installing one adds an ordinary checklist you
            can edit and attach to a routine. Photo evidence is not captured yet.
          </p>
          <ul className={styles.items}>
            {library.map((r) => (
              <li key={r.key} className={styles.item}>
                <span className={styles.itemLabel}>
                  <strong>{r.name}</strong> · {r.items.length} items — {r.description}
                </span>
                {r.installed ? (
                  <span className={styles.badge}>Installed</span>
                ) : (
                  <button
                    type="button"
                    className={styles.action}
                    disabled={busy}
                    aria-label={`Install ${r.name}`}
                    onClick={() =>
                      void run(() => tasksApi.installReference(ctx!, r.key), `${r.name} installed.`)
                    }
                  >
                    Install
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!listed ? null : templates.length === 0 ? (
        <p className={styles.empty}>No checklists yet.</p>
      ) : (
        <ul className={styles.list}>
          {templates.map((c) => (
            <li key={c.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.titleLink} style={{ color: 'inherit' }}>
                  {c.name}
                </span>
                <span className={`${styles.badge} ${c.status === 'ACTIVE' ? styles.badgeProgress : styles.badgeCancelled}`}>
                  {c.status === 'ACTIVE' ? 'Active' : 'Retired'}
                </span>
                <span className={styles.spacer} />
                <span className={styles.meta}>{c.items.length} items</span>
              </div>
              <ul className={styles.items}>
                {c.items.map((i) => (
                  <li key={i.id} className={styles.item}>
                    <span className={styles.itemLabel}>{i.label}</span>
                    {i.kind !== 'CHECK' ? <span className={styles.badge}>{KIND_LABEL[i.kind]}</span> : null}
                    {i.is_required ? (
                      <span className={styles.badge}>Required</span>
                    ) : (
                      <span className={styles.badge}>Optional</span>
                    )}
                  </li>
                ))}
              </ul>
              {mayManage ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          tasksApi.updateChecklist(ctx!, c.id, {
                            status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                          }),
                        c.status === 'ACTIVE' ? 'Checklist retired.' : 'Checklist restored.',
                      )
                    }
                  >
                    {c.status === 'ACTIVE' ? 'Retire' : 'Restore'}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className={styles.hint}>
        Editing a checklist never changes tasks that already exist — each task keeps the copy it was
        created with.
      </p>
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { adminApi, type PermissionEntry, type RoleRecord } from '@/lib/admin/api';
import styles from '@/components/settings/settings.module.css';
import admin from '@/components/admin/admin.module.css';

/**
 * Company roles and the permissions each carries.
 *
 * ESCALATION STAYS SERVER-SIDE. An administrator may only add a permission they
 * already hold; the API refuses anything else. This page mirrors that by
 * disabling such boxes — a courtesy, not the control — while still letting an
 * existing permission be kept or removed, exactly as the API allows.
 */
export default function RolesPage() {
  const { selectedCompanyId, companyPermissions } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'roles.view');
  const mayCreate = hasPermission(companyPermissions, 'roles.create');
  const mayUpdate = hasPermission(companyPermissions, 'roles.update');

  const [roles, setRoles] = useState<RoleRecord[] | null>(null);
  const [catalogue, setCatalogue] = useState<PermissionEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [mode, setMode] = useState<'none' | 'create' | 'rename'>('none');
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const [roleList, entries] = await Promise.all([
        adminApi.roles(selectedCompanyId),
        adminApi.permissionCatalogue(selectedCompanyId),
      ]);
      setRoles(roleList ?? []);
      setCatalogue(entries ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load roles');
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  const modules = useMemo(() => {
    const grouped = new Map<string, PermissionEntry[]>();
    for (const p of catalogue) grouped.set(p.module, [...(grouped.get(p.module) ?? []), p]);
    return [...grouped.entries()];
  }, [catalogue]);

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1>Roles</h1>
        <p className={styles.notice}>Select a company first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Roles</h1>
        <p className={styles.notice}>You do not have access to roles.</p>
      </section>
    );
  }

  const selected = roles?.find((r) => r.id === selectedId) ?? null;
  const current = new Set(selected?.permissions.map((p) => p.permission.name) ?? []);
  const held = new Set(companyPermissions);

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changed =
    !!draft && (draft.size !== current.size || [...draft].some((name) => !current.has(name)));

  return (
    <section className={styles.page}>
      <header>
        <h1>Roles</h1>
        <p className={styles.intro}>
          A role is a named set of permissions. People receive roles per branch on the{' '}
          <Link href="/settings/users">Users</Link> page.
        </p>
      </header>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {mayCreate ? (
        <div className={styles.bar}>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            disabled={busy}
            onClick={() => {
              setForm({ name: '', description: '' });
              setMode('create');
              setSelectedId(null);
              setDraft(null);
              setNotice(null);
            }}
          >
            Add role
          </button>
        </div>
      ) : null}

      <div className={admin.split}>
        <div>
          {roles === null ? (
            error ? null : (
              <p role="status" aria-live="polite">
                Loading roles…
              </p>
            )
          ) : roles.length === 0 ? (
            <p className={styles.notice}>This company has no roles yet.</p>
          ) : (
            <ul className={styles.list} aria-label="Roles">
              {roles.map((r) => (
                <li key={r.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <button
                      type="button"
                      className={admin.rowButton}
                      aria-current={selectedId === r.id ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(r.id);
                        setDraft(null);
                        setMode('none');
                      }}
                    >
                      {r.name}
                    </button>
                    <span className={styles.badge}>
                      {r.permissions.length} {r.permissions.length === 1 ? 'permission' : 'permissions'}
                    </span>
                  </div>
                  {r.description ? <div className={styles.meta}>{r.description}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside aria-label="Role details">
          {mode === 'create' || (mode === 'rename' && selected) ? (
            <form
              className={styles.card}
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim()) return;
                void (async () => {
                  const body = { name: form.name.trim(), description: form.description.trim() || undefined };
                  const ok =
                    mode === 'create'
                      ? await run(() => adminApi.createRole(selectedCompanyId, body), `Added role ${body.name}.`, 'Could not add the role')
                      : await run(
                          () => adminApi.updateRole(selectedCompanyId, selected!.id, body),
                          `Saved role ${body.name}.`,
                          'Could not save the role',
                        );
                  if (ok) setMode('none');
                })();
              }}
            >
              <h2 className={styles.title}>{mode === 'create' ? 'New role' : `Rename ${selected?.name}`}</h2>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="role-name">
                  Name
                </label>
                <input
                  id="role-name"
                  className={styles.input}
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="role-description">
                  Description (optional)
                </label>
                <input
                  id="role-description"
                  className={styles.input}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className={styles.bar}>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !form.name.trim()}>
                  {mode === 'create' ? 'Add' : 'Save'}
                </button>
                <button type="button" className={styles.button} onClick={() => setMode('none')}>
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <div className={styles.card}>
              <div className={styles.cardTop}>
                <h2 className={styles.title}>{selected.name}</h2>
                <span className={styles.spacer} />
                {mayUpdate ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => {
                      setForm({ name: selected.name, description: selected.description ?? '' });
                      setMode('rename');
                    }}
                  >
                    Rename
                  </button>
                ) : null}
                {mayUpdate && !draft ? (
                  <button type="button" className={styles.button} disabled={busy} onClick={() => setDraft(new Set(current))}>
                    Edit permissions
                  </button>
                ) : null}
              </div>

              {draft ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      const ok = await run(
                        () => adminApi.setRolePermissions(selectedCompanyId, selected.id, [...draft].sort()),
                        `Saved permissions for ${selected.name}.`,
                        'Could not save the permissions',
                      );
                      if (ok) setDraft(null);
                    })();
                  }}
                  className={styles.page}
                >
                  <p className={styles.meta}>
                    You can add only permissions you hold yourself. Permissions already on the role can be kept or
                    removed.
                  </p>
                  {modules.map(([module, entries]) => (
                    <fieldset key={module} className={admin.permissionGroup}>
                      <legend>{module.replace(/_/g, ' ')}</legend>
                      <div className={admin.permissionGrid}>
                        {entries.map((p) => {
                          const checked = draft.has(p.name);
                          const locked = !checked && !current.has(p.name) && !held.has(p.name);
                          return (
                            <label key={p.name} className={admin.check} title={locked ? 'You do not hold this permission' : undefined}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={busy || locked}
                                onChange={(e) => {
                                  const next = new Set(draft);
                                  if (e.target.checked) next.add(p.name);
                                  else next.delete(p.name);
                                  setDraft(next);
                                }}
                              />
                              <span>
                                {p.description ?? p.name}
                                <span className={styles.meta}> ({p.name})</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                  <div className={styles.bar}>
                    <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy || !changed}>
                      Save permissions
                    </button>
                    <button type="button" className={styles.button} onClick={() => setDraft(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : current.size === 0 ? (
                <p className={styles.meta}>This role carries no permissions.</p>
              ) : (
                modules
                  .map(([module, entries]) => [module, entries.filter((p) => current.has(p.name))] as const)
                  .filter(([, entries]) => entries.length > 0)
                  .map(([module, entries]) => (
                    <div key={module}>
                      <h3 className={styles.label} style={{ textTransform: 'capitalize' }}>
                        {module.replace(/_/g, ' ')}
                      </h3>
                      <ul className={admin.chips}>
                        {entries.map((p) => (
                          <li key={p.name} className={admin.chip} style={{ paddingRight: 12 }}>
                            {p.description ?? p.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
              )}
            </div>
          ) : (
            <p className={styles.meta}>Choose a role to see its permissions.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

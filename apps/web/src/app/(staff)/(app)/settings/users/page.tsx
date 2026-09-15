'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { useAuth } from '@/lib/auth/auth-provider';
import { hasPermission } from '@/lib/auth/permissions';
import {
  adminApi,
  personName,
  type ActiveStatus,
  type BranchRoleAssignment,
  type RoleRecord,
} from '@/lib/admin/api';
import { formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';
import admin from '@/components/admin/admin.module.css';

interface Row {
  userId: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  /** Null when this company cannot see the account (an inactive member). */
  accountStatus: ActiveStatus | null;
  membershipId: string | null;
  membershipStatus: ActiveStatus;
  joined: string | null;
}

/**
 * Company users: who belongs, whether they can sign in, and the roles they hold
 * at each branch.
 *
 * Every control mirrors a server rule rather than inventing one:
 *   - removing someone from THIS company is a membership change;
 *   - "Disable sign-in" is the platform-wide account switch, which the API
 *     refuses for anyone who also belongs to another company;
 *   - roles are assigned at the selected branch only, and only a role whose
 *     permissions the actor already holds (the API enforces this);
 *   - nobody changes their own membership, account or roles here.
 */
export default function UsersPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, companyPermissions, branchPermissions } =
    useAppContext();
  const { user: me } = useAuth();

  const mayView = hasPermission(companyPermissions, 'users.view');
  const mayCreate = hasPermission(companyPermissions, 'users.create');
  const mayRename = hasPermission(companyPermissions, 'users.update');
  const mayDisable = hasPermission(companyPermissions, 'users.disable');
  const maySeeMembers = hasPermission(companyPermissions, 'memberships.view');
  const mayChangeMembership = hasPermission(companyPermissions, 'memberships.update');
  const maySeeRoles = hasPermission(companyPermissions, 'roles.view');
  const mayAssignHere = !!selectedBranchId && hasPermission(branchPermissions, 'users.update');

  const [rows, setRows] = useState<Row[] | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<BranchRoleAssignment[] | null>(null);
  const [roleToAssign, setRoleToAssign] = useState('');
  const [mode, setMode] = useState<'none' | 'create' | 'rename'>('none');
  const [createForm, setCreateForm] = useState({ email: '', first_name: '', last_name: '', password: '' });
  const [renameForm, setRenameForm] = useState({ first_name: '', last_name: '' });
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const [users, members, roleList] = await Promise.all([
        adminApi.users(selectedCompanyId),
        maySeeMembers ? adminApi.members(selectedCompanyId) : Promise.resolve(null),
        maySeeRoles ? adminApi.roles(selectedCompanyId) : Promise.resolve([] as RoleRecord[]),
      ]);
      const accounts = new Map((users ?? []).map((u) => [u.id, u]));
      const next: Row[] = members
        ? members.map((m) => ({
            userId: m.user.id,
            email: m.user.email,
            first_name: m.user.first_name,
            last_name: m.user.last_name,
            accountStatus: accounts.get(m.user.id)?.status ?? null,
            membershipId: m.id,
            membershipStatus: m.status,
            joined: m.created_at,
          }))
        : (users ?? []).map((u) => ({
            userId: u.id,
            email: u.email,
            first_name: u.first_name,
            last_name: u.last_name,
            accountStatus: u.status,
            membershipId: null,
            membershipStatus: 'ACTIVE' as const,
            joined: null,
          }));
      next.sort((a, b) => personName(a).localeCompare(personName(b)));
      setRows(next);
      setRoles(roleList ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load users');
    }
  }, [selectedCompanyId, maySeeMembers, maySeeRoles]);

  const loadAssignments = useCallback(
    async (userId: string) => {
      if (!selectedCompanyId) return;
      try {
        setAssignments(await adminApi.branchRoles(selectedCompanyId, userId));
      } catch (e) {
        setAssignments(null);
        setError(e instanceof Error ? e.message : 'Could not load role assignments');
      }
    },
    [selectedCompanyId],
  );

  useEffect(() => {
    if (!mayView) return;
    void (async () => {
      await load();
    })();
  }, [load, mayView]);

  if (!selectedCompanyId) {
    return (
      <section className={styles.page}>
        <h1>Users</h1>
        <p className={styles.notice}>Select a company first.</p>
      </section>
    );
  }
  if (!mayView) {
    return (
      <section className={styles.page}>
        <h1>Users</h1>
        <p className={styles.notice}>You do not have access to users.</p>
      </section>
    );
  }

  const selected = rows?.find((r) => r.userId === selectedId) ?? null;
  const isMe = !!selected && selected.userId === me?.id;
  const activeMember = selected?.membershipStatus === 'ACTIVE';

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

  const open = (row: Row) => {
    setSelectedId(row.userId);
    setMode('none');
    setAssignments(null);
    setRoleToAssign('');
    if (row.membershipStatus === 'ACTIVE') void loadAssignments(row.userId);
  };

  const visibleRows = (rows ?? []).filter((r) => {
    const f = filter.trim().toLowerCase();
    return !f || personName(r).toLowerCase().includes(f) || r.email.toLowerCase().includes(f);
  });
  const assignableRoles = roles.filter(
    (r) => !assignments?.some((a) => a.role.id === r.id && a.branch.id === selectedBranchId),
  );

  return (
    <section className={styles.page}>
      <header>
        <h1>Users</h1>
        <p className={styles.intro}>People in this company, whether they can sign in, and their roles at each branch.</p>
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

      <div className={styles.bar}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-filter">
            Find by name or email
          </label>
          <input id="user-filter" className={styles.input} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <span className={styles.spacer} />
        {mayCreate ? (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => {
              setCreateForm({ email: '', first_name: '', last_name: '', password: '' });
              setMode('create');
              setSelectedId(null);
              setNotice(null);
            }}
          >
            Add user
          </button>
        ) : null}
      </div>

      <div className={admin.split}>
        <div>
          {rows === null ? (
            error ? null : (
              <p role="status" aria-live="polite">
                Loading users…
              </p>
            )
          ) : visibleRows.length === 0 ? (
            <p className={styles.notice}>{filter ? 'Nobody matches.' : 'This company has no users.'}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Users">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">In this company</th>
                    <th scope="col">Sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.userId} aria-selected={selectedId === r.userId}>
                      <td>
                        <button type="button" className={admin.rowButton} onClick={() => open(r)}>
                          {personName(r)}
                        </button>
                      </td>
                      <td>{r.email}</td>
                      <td>{r.membershipStatus === 'ACTIVE' ? 'Member' : 'Removed'}</td>
                      <td>{r.accountStatus === null ? '—' : r.accountStatus === 'ACTIVE' ? 'Enabled' : 'Disabled'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside aria-label="User details">
          {mode === 'create' ? (
            <form
              className={styles.card}
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  const ok = await run(
                    () =>
                      adminApi.createUser(selectedCompanyId, {
                        email: createForm.email.trim(),
                        password: createForm.password,
                        ...(createForm.first_name.trim() ? { first_name: createForm.first_name.trim() } : {}),
                        ...(createForm.last_name.trim() ? { last_name: createForm.last_name.trim() } : {}),
                      }),
                    `Added ${createForm.email.trim()}. Share the initial password with them in person; they should change it after signing in.`,
                    'Could not add the user',
                  );
                  if (ok) {
                    setMode('none');
                    setCreateForm({ email: '', first_name: '', last_name: '', password: '' });
                  }
                })();
              }}
            >
              <h2 className={styles.title}>New user</h2>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-email">
                  Email
                </label>
                <input
                  id="new-email"
                  className={styles.input}
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-first">
                  First name
                </label>
                <input
                  id="new-first"
                  className={styles.input}
                  value={createForm.first_name}
                  onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-last">
                  Last name
                </label>
                <input
                  id="new-last"
                  className={styles.input}
                  value={createForm.last_name}
                  onChange={(e) => setCreateForm({ ...createForm, last_name: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-password">
                  Initial password
                </label>
                <input
                  id="new-password"
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  required
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </div>
              <div className={styles.bar}>
                <button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={busy || !createForm.email.trim() || !createForm.password}
                >
                  Add
                </button>
                <button type="button" className={styles.button} onClick={() => setMode('none')}>
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <div className={styles.card}>
              <h2 className={styles.title}>{personName(selected)}</h2>
              <dl className={admin.details}>
                <dt>Email</dt>
                <dd>{selected.email}</dd>
                <dt>In this company</dt>
                <dd>{activeMember ? 'Member' : 'Removed'}</dd>
                <dt>Sign-in</dt>
                <dd>
                  {selected.accountStatus === null ? 'Not shown for removed members' : selected.accountStatus === 'ACTIVE' ? 'Enabled' : 'Disabled'}
                </dd>
                {selected.joined ? (
                  <>
                    <dt>Joined</dt>
                    <dd>{formatDateTime(selected.joined)}</dd>
                  </>
                ) : null}
              </dl>
              {isMe ? <p className={styles.meta}>This is you. Your own access is changed by another administrator.</p> : null}

              {mode === 'rename' ? (
                <form
                  className={styles.bar}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      const ok = await run(
                        () =>
                          adminApi.updateUser(selectedCompanyId, selected.userId, {
                            first_name: renameForm.first_name.trim(),
                            last_name: renameForm.last_name.trim(),
                          }),
                        'Name saved.',
                        'Could not save the name',
                      );
                      if (ok) setMode('none');
                    })();
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="edit-first">
                      First name
                    </label>
                    <input
                      id="edit-first"
                      className={styles.input}
                      value={renameForm.first_name}
                      onChange={(e) => setRenameForm({ ...renameForm, first_name: e.target.value })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="edit-last">
                      Last name
                    </label>
                    <input
                      id="edit-last"
                      className={styles.input}
                      value={renameForm.last_name}
                      onChange={(e) => setRenameForm({ ...renameForm, last_name: e.target.value })}
                    />
                  </div>
                  <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
                    Save
                  </button>
                  <button type="button" className={styles.button} onClick={() => setMode('none')}>
                    Cancel
                  </button>
                </form>
              ) : null}

              <div className={styles.bar}>
                {mayRename && activeMember && mode !== 'rename' ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => {
                      setRenameForm({ first_name: selected.first_name ?? '', last_name: selected.last_name ?? '' });
                      setMode('rename');
                    }}
                  >
                    Edit name
                  </button>
                ) : null}
                {mayChangeMembership && selected.membershipId && !isMe ? (
                  <button
                    type="button"
                    className={`${styles.button} ${activeMember ? styles.danger : ''}`}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          adminApi.setMembershipStatus(
                            selectedCompanyId,
                            selected.membershipId!,
                            activeMember ? 'INACTIVE' : 'ACTIVE',
                          ),
                        activeMember
                          ? `${personName(selected)} was removed from this company.`
                          : `${personName(selected)} is a member again.`,
                        'Could not change the membership',
                      )
                    }
                  >
                    {activeMember ? 'Remove from company' : 'Restore membership'}
                  </button>
                ) : null}
                {mayDisable && activeMember && selected.accountStatus !== null && !isMe ? (
                  <button
                    type="button"
                    className={`${styles.button} ${selected.accountStatus === 'ACTIVE' ? styles.danger : ''}`}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          adminApi.setUserStatus(
                            selectedCompanyId,
                            selected.userId,
                            selected.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                          ),
                        selected.accountStatus === 'ACTIVE'
                          ? `${personName(selected)} can no longer sign in, and their devices were signed out.`
                          : `${personName(selected)} can sign in again.`,
                        'Could not change sign-in',
                      )
                    }
                  >
                    {selected.accountStatus === 'ACTIVE' ? 'Disable sign-in' : 'Enable sign-in'}
                  </button>
                ) : null}
              </div>

              {activeMember ? (
                <>
                  <h3 className={styles.title}>Roles</h3>
                  {assignments === null ? (
                    <p role="status" aria-live="polite">
                      Loading roles…
                    </p>
                  ) : assignments.length === 0 ? (
                    <p className={styles.meta}>No roles at any branch — this person can sign in but do nothing.</p>
                  ) : (
                    <ul className={admin.chips} aria-label="Role assignments">
                      {assignments.map((a) => (
                        <li key={a.id} className={admin.chip}>
                          <span>
                            {a.role.name} · {a.branch.name}
                          </span>
                          {mayAssignHere && a.branch.id === selectedBranchId && !isMe ? (
                            <button
                              type="button"
                              className={`${styles.button} ${styles.danger}`}
                              disabled={busy}
                              aria-label={`Remove ${a.role.name} at ${a.branch.name}`}
                              onClick={() =>
                                void (async () => {
                                  await run(
                                    () =>
                                      adminApi.removeBranchRole(selectedCompanyId, selectedBranchId!, selected.userId, a.id),
                                    `Removed ${a.role.name} at ${a.branch.name}.`,
                                    'Could not remove the role',
                                  );
                                  await loadAssignments(selected.userId);
                                })()
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {mayAssignHere && maySeeRoles && !isMe ? (
                    <form
                      className={styles.bar}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!roleToAssign) return;
                        void (async () => {
                          const role = roles.find((r) => r.id === roleToAssign);
                          const ok = await run(
                            () =>
                              adminApi.assignBranchRole(selectedCompanyId, selectedBranchId!, selected.userId, roleToAssign),
                            `Assigned ${role?.name ?? 'the role'} at ${selectedBranch?.name ?? 'this branch'}.`,
                            'Could not assign the role',
                          );
                          if (ok) setRoleToAssign('');
                          await loadAssignments(selected.userId);
                        })();
                      }}
                    >
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="assign-role">
                          Assign a role at {selectedBranch?.name ?? 'this branch'}
                        </label>
                        <select
                          id="assign-role"
                          className={styles.select}
                          value={roleToAssign}
                          onChange={(e) => setRoleToAssign(e.target.value)}
                        >
                          <option value="">Choose a role</option>
                          {assignableRoles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className={styles.button} disabled={busy || !roleToAssign}>
                        Assign
                      </button>
                    </form>
                  ) : null}
                  {mayAssignHere || !selectedBranchId ? null : (
                    <p className={styles.meta}>Role changes are made at a branch where you may manage users.</p>
                  )}
                </>
              ) : null}
            </div>
          ) : (
            <p className={styles.meta}>Choose a person to see their access.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

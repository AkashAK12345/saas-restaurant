'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { userAccessApi, type AccessCatalogue, type UserListEntry } from '@/lib/users/access';
import { AppIcon } from '@/components/app/icons';
import { ScreenHeader } from '@/components/users/controls';
import { UserList } from '@/components/users/user-list';
import { UserAccessForm, type AccessFormValues } from '@/components/users/user-access-form';
import styles from '@/components/users/users.module.css';

type Tab = 'existing' | 'create' | 'groups';

const TABS: { key: Tab; label: string }[] = [
  { key: 'existing', label: 'Existing Users' },
  { key: 'create', label: 'Create New' },
  { key: 'groups', label: 'Groups' },
];

/**
 * User Management — who works here and what each person may do.
 *
 * Existing Users lists every member; Create New makes an account and sets
 * its access in one go. Access is chosen as toggles; the API turns them into
 * the permission keys every endpoint checks, and refuses to hand out any key
 * the person saving does not hold.
 */
export default function UserManagementPage() {
  const { selectedCompanyId, companyPermissions } = useAppContext();
  const mayView = hasPermission(companyPermissions, 'users.view');
  const mayCreate = hasPermission(companyPermissions, 'users.create');

  const [tab, setTab] = useState<Tab>('existing');
  const [catalogue, setCatalogue] = useState<AccessCatalogue | null>(null);
  const [users, setUsers] = useState<UserListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Remounts the form after a create, so it starts empty again.
  const [formKey, setFormKey] = useState(0);

  // Bumped to load the list again (after a create).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!selectedCompanyId || !mayView) return;
    let live = true;
    Promise.all([userAccessApi.catalogue(selectedCompanyId), userAccessApi.list(selectedCompanyId)])
      .then(([c, u]) => {
        if (!live) return;
        setCatalogue(c);
        setUsers(u);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not load users.');
      });
    return () => {
      live = false;
    };
  }, [selectedCompanyId, mayView, version]);

  const create = async (values: AccessFormValues) => {
    if (!selectedCompanyId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await userAccessApi.create(selectedCompanyId, {
        email: values.email!,
        password: values.password!,
        user_type: values.user_type,
        corporate: values.corporate,
        branch_id: values.branch_id,
        access: values.access,
      });
      setNotice(`${created.email} can now sign in.`);
      setFormKey((k) => k + 1);
      setTab('existing');
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <ScreenHeader
        title="User Management"
        back={
          <Link className={styles.back} href="/settings" aria-label="Back to Settings">
            <AppIcon name="back" size={26} />
          </Link>
        }
      />
      {!mayView ? (
        <p className={styles.error} role="alert">
          You do not have permission to manage users.
        </p>
      ) : (
        <>
          <div className={styles.tabs} role="tablist" aria-label="User Management">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`users-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="users-panel"
                className={styles.tab}
                onClick={() => {
                  setTab(t.key);
                  setNotice(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.panel} role="tabpanel" id="users-panel" aria-labelledby={`users-tab-${tab}`}>
            {notice ? (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            {tab === 'existing' ? (
              users && catalogue ? (
                <UserList users={users} branches={catalogue.branches} />
              ) : !error ? (
                <p className={styles.empty}>Loading users…</p>
              ) : null
            ) : null}

            {tab === 'create' ? (
              !mayCreate ? (
                <p className={styles.empty}>You do not have permission to create users.</p>
              ) : catalogue ? (
                <UserAccessForm key={formKey} catalogue={catalogue} mode="create" busy={busy} onSubmit={create} />
              ) : (
                <p className={styles.empty}>Loading…</p>
              )
            ) : null}

            {tab === 'groups' ? (
              <p className={styles.empty}>Groups are not available in this version of SAMCO yet.</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

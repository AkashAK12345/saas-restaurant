'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import { memberSummary, userGroupsApi, type UserGroup, type UserListEntry } from '@/lib/users/access';
import { GroupDialog } from './group-dialog';
import styles from './users.module.css';

/**
 * The Groups tab: search, "Create group", and a card per group showing how
 * many are in it and who. Tapping a card edits it. Without users.update the
 * list is read-only.
 */
export function GroupList({
  companyId,
  users,
  mayEdit,
}: {
  companyId: string;
  users: readonly UserListEntry[];
  mayEdit: boolean;
}) {
  const [groups, setGroups] = useState<UserGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // undefined: closed; null: creating; a group: editing it.
  const [open, setOpen] = useState<UserGroup | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    userGroupsApi
      .list(companyId)
      .then((g) => {
        if (live) {
          setGroups(g);
          setLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setLoadError(e instanceof Error ? e.message : 'Could not load groups.');
      });
    return () => {
      live = false;
    };
  }, [companyId, version]);

  const close = useCallback(() => {
    setOpen(undefined);
    setError(null);
  }, []);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setNotice(done);
      setOpen(undefined);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the group.');
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));

  return (
    <>
      <div className={styles.search}>
        <AppIcon name="search" size={24} />
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search groups..."
          aria-label="Search groups"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {mayEdit ? (
        <button
          type="button"
          className={styles.createGroup}
          onClick={() => {
            setNotice(null);
            setOpen(null);
          }}
        >
          <AppIcon name="personAdd" size={26} />
          Create group
        </button>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="status" style={{ marginTop: 'var(--gap)' }}>
          {notice}
        </p>
      ) : null}
      {loadError ? (
        <p className={styles.error} role="alert" style={{ marginTop: 'var(--gap)' }}>
          {loadError}
        </p>
      ) : null}

      {groups === null ? (
        !loadError ? <p className={styles.empty}>Loading groups…</p> : null
      ) : shown.length === 0 ? (
        <p className={styles.empty}>{groups.length === 0 ? 'No groups yet.' : 'No groups match.'}</p>
      ) : (
        <ul className={styles.groupList} aria-label="Groups">
          {shown.map((g) => {
            const body = (
              <>
                <span className={styles.groupIcon} aria-hidden="true">
                  <AppIcon name="group" size={32} />
                </span>
                <span className={styles.userText}>
                  <span className={styles.groupName}>{g.name}</span>
                  <span className={styles.groupCount}>
                    {g.members.length} {g.members.length === 1 ? 'member' : 'members'}
                  </span>
                  {g.members.length > 0 ? (
                    <span className={styles.groupMembers}>{memberSummary(g.members.map((m) => m.name))}</span>
                  ) : null}
                </span>
                {mayEdit ? (
                  <span className={styles.chevron}>
                    <AppIcon name="chevronRight" size={22} />
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={g.id}>
                {mayEdit ? (
                  <button
                    type="button"
                    className={styles.groupCard}
                    aria-label={`${g.name}, ${g.members.length} members`}
                    onClick={() => {
                      setNotice(null);
                      setOpen(g);
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={styles.groupCard}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open !== undefined ? (
        <GroupDialog
          group={open ?? undefined}
          users={users.filter((u) => u.status === 'ACTIVE' || open?.members.some((m) => m.id === u.id))}
          busy={busy}
          error={error}
          onClose={close}
          onSave={(body) =>
            void run(
              () => (open ? userGroupsApi.save(companyId, open.id, body) : userGroupsApi.create(companyId, body)),
              open ? `${body.name} saved.` : `${body.name} created.`,
            )
          }
          onDelete={open ? () => void run(() => userGroupsApi.remove(companyId, open.id), `${open.name} deleted.`) : undefined}
        />
      ) : null}
    </>
  );
}

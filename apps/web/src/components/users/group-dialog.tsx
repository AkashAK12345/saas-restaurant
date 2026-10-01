'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import { avatarTone, initials, type UserGroup, type UserListEntry } from '@/lib/users/access';
import styles from './users.module.css';

/**
 * Create or edit a group: its name and who is in it.
 *
 * When editing, the people already in the group are listed first under
 * MEMBERS and everyone else under ALL USERS. The split is fixed when the
 * dialog opens, so ticking someone never moves the row under your thumb.
 */
export function GroupDialog({
  group,
  users,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  /** Absent when creating. */
  group?: UserGroup;
  users: readonly UserListEntry[];
  busy: boolean;
  error: string | null;
  onSave: (body: { name: string; member_ids: string[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(group?.members.map((m) => m.id)));
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => new Set(group?.members.map((m) => m.id)), [group]);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matching = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const members = matching.filter((u) => initial.has(u.id));
  const others = matching.filter((u) => !initial.has(u.id));
  const ready = name.trim().length > 0 && chosen.size > 0;

  const toggle = (id: string) =>
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (u: UserListEntry) => (
    <li key={u.id}>
      <button type="button" role="checkbox" aria-checked={chosen.has(u.id)} className={styles.pick} onClick={() => toggle(u.id)}>
        <span className={styles.avatar} data-tone={avatarTone(u.id)} aria-hidden="true">
          {initials(u.name)}
        </span>
        <span className={styles.userText}>
          <span className={styles.userName}>{u.name}</span>
          <span className={styles.userEmail}>{u.email}</span>
        </span>
        <span className={styles.box} aria-hidden="true">
          <AppIcon name="check" size={22} />
        </span>
      </button>
    </li>
  );

  const title = group ? 'Edit group' : 'Create group';

  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHead}>
          <span className={styles.dialogIcon}>
            <AppIcon name="group" size={30} />
          </span>
          <h2 className={styles.dialogTitle} id="group-dialog-title">
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <AppIcon name="close" size={26} />
          </button>
        </div>

        <div className={styles.dialogBody}>
          <input
            ref={nameRef}
            className={styles.nameInput}
            aria-label="Group name"
            placeholder="Group name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className={styles.pickRow}>
            <div className={styles.search}>
              <AppIcon name="search" size={24} />
              <input
                className={styles.searchInput}
                type="search"
                aria-label="Search users"
                placeholder="Search users..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className={`${styles.selected} ${chosen.size > 0 ? styles.selectedSome : ''}`} aria-live="polite">
              {chosen.size} selected
            </span>
          </div>

          {members.length > 0 ? (
            <>
              <p className={styles.pickLabel} id="group-members-label">
                Members
              </p>
              <ul className={styles.pickList} aria-labelledby="group-members-label">
                {members.map(row)}
              </ul>
              <p className={styles.pickLabel} id="group-all-label">
                All users
              </p>
              <ul className={styles.pickList} aria-labelledby="group-all-label">
                {others.map(row)}
              </ul>
            </>
          ) : (
            <ul className={styles.pickList} aria-label="Users">
              {others.map(row)}
            </ul>
          )}
          {matching.length === 0 ? <p className={styles.empty}>No users match.</p> : null}
        </div>

        {error ? (
          <p className={styles.error} role="alert" style={{ margin: '0 22px 12px' }}>
            {error}
          </p>
        ) : null}
        <div className={styles.dialogFoot}>
          {group && onDelete ? (
            <button
              type="button"
              className={styles.delete}
              disabled={busy}
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            >
              <AppIcon name="trash" size={24} />
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
          ) : null}
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!ready || busy}
            onClick={() => onSave({ name: name.trim(), member_ids: [...chosen] })}
          >
            {busy ? 'Saving…' : group ? 'Save changes' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import {
  avatarTone,
  CORPORATE,
  initials,
  USER_TYPE_LABEL,
  type UserListEntry,
  type UserType,
} from '@/lib/users/access';
import { Dropdown } from './controls';
import styles from './users.module.css';

const ALL = 'all';

/**
 * Existing Users: search, filter by branch and by type, and open a member to
 * change their access. Filtering is in the browser — a company's whole staff
 * list is one small response.
 */
export function UserList({
  users,
  branches,
}: {
  users: readonly UserListEntry[];
  branches: readonly { id: string; name: string }[];
}) {
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState<string>(ALL);
  const [type, setType] = useState<UserType | typeof ALL>(ALL);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (branch === CORPORATE && !u.corporate) return false;
      if (branch !== ALL && branch !== CORPORATE && u.branch?.id !== branch) return false;
      return type === ALL || u.user_type === type;
    });
  }, [users, query, branch, type]);

  return (
    <>
      <div className={styles.search}>
        <AppIcon name="search" size={24} />
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search users..."
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={styles.filters}>
        <Dropdown
          label="Branch filter"
          value={branch}
          options={[
            { value: ALL, label: 'All Branches' },
            { value: CORPORATE, label: 'Corporate' },
            ...branches.map((b) => ({ value: b.id, label: b.name })),
          ]}
          onChange={setBranch}
        />
        <Dropdown<UserType | typeof ALL>
          label="Role filter"
          value={type}
          options={[
            { value: ALL, label: 'All Roles' },
            { value: 'ADMIN', label: 'Admin' },
            { value: 'MANAGER', label: 'Manager' },
            { value: 'STAFF', label: 'Staff' },
          ]}
          onChange={setType}
        />
      </div>

      <p className={styles.count} aria-live="polite">
        {shown.length} {shown.length === 1 ? 'user' : 'users'}
      </p>
      {shown.length === 0 ? (
        <p className={styles.empty}>No users match.</p>
      ) : (
        <ul className={styles.list} aria-label="Users">
          {shown.map((u) => (
            <li key={u.id}>
              <Link className={styles.userCard} href={`/settings/users/${u.id}`} aria-label={`${u.name}, ${u.email}`}>
                <span className={styles.avatar} data-tone={avatarTone(u.id)} aria-hidden="true">
                  {initials(u.name)}
                </span>
                <span className={styles.userText}>
                  <span className={styles.userName}>{u.name}</span>
                  <span className={styles.userEmail}>{u.email}</span>
                  <span className={styles.badges}>
                    {u.corporate ? (
                      <span className={`${styles.badge} ${styles.badgeCorporate}`}>Corporate</span>
                    ) : u.branch ? (
                      <span className={styles.badge}>{u.branch.name}</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>No branch</span>
                    )}
                    {u.owner ? <span className={`${styles.badge} ${styles.badgeOwner}`}>Owner</span> : null}
                    {u.status === 'INACTIVE' ? (
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>Disabled</span>
                    ) : null}
                    <span className="sr-only">{USER_TYPE_LABEL[u.user_type]}</span>
                  </span>
                </span>
                <span className={styles.chevron}>
                  <AppIcon name="chevronRight" size={22} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

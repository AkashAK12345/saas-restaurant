'use client';

import { useState, type FormEvent } from 'react';
import { AppIcon, type AppIconName } from '@/components/app/icons';
import {
  CORPORATE,
  matchingPreset,
  USER_TYPE_LABEL,
  type AccessCatalogue,
  type AccessSelection,
  type RoutineLevel,
  type SaveUserAccess,
  type TaskMode,
  type UserType,
} from '@/lib/users/access';
import { Dropdown, Segmented, Switch } from './controls';
import styles from './users.module.css';

/** Icon and tint per section, as the reference draws them. */
const SECTION_LOOK: Record<string, { icon: AppIconName; tone: string }> = {
  queue: { icon: 'people', tone: 'green' },
  banquet: { icon: 'building', tone: 'amber' },
  routines: { icon: 'checkSquare', tone: 'terracotta' },
  tasks: { icon: 'send', tone: 'green' },
  reports: { icon: 'barChart', tone: 'purple' },
  pos: { icon: 'receipt', tone: 'blue' },
  inventory: { icon: 'archive', tone: 'green' },
  finance: { icon: 'wallet', tone: 'purple' },
};

/** The routine and task sections sit between Banquet and Reports. */
const AFTER_BANQUET = 'banquet';

const MIN_PASSWORD = 8;

export interface AccessFormValues extends SaveUserAccess {
  email?: string;
  password?: string;
}

export function UserAccessForm({
  catalogue,
  mode,
  initial,
  email: fixedEmail,
  notice,
  locked,
  busy,
  onSubmit,
}: {
  catalogue: AccessCatalogue;
  mode: 'create' | 'edit';
  initial?: { user_type: UserType; corporate: boolean; branch_id: string | null; access: AccessSelection };
  /** Edit: the member's email, shown but not editable. */
  email?: string;
  /** A line above the permissions, e.g. that saving replaces older roles. */
  notice?: string;
  /** Why the form cannot be saved, if it cannot. */
  locked?: string;
  busy: boolean;
  onSubmit: (values: AccessFormValues) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [branch, setBranch] = useState<string | null>(
    initial ? (initial.corporate ? CORPORATE : initial.branch_id) : null,
  );
  const [userType, setUserType] = useState<UserType>(initial?.user_type ?? 'STAFF');
  const [selection, setSelection] = useState<AccessSelection>(
    initial?.access ?? { toggles: [], routines: {}, tasks: 'OFF' },
  );
  const [problem, setProblem] = useState<string | null>(null);

  const on = new Set(selection.toggles);
  const setToggles = (keys: string[], value: boolean) =>
    setSelection((s) => {
      const next = new Set(s.toggles);
      for (const k of keys) {
        if (value) next.add(k);
        else next.delete(k);
      }
      return { ...s, toggles: [...next] };
    });
  const setRoutine = (key: string, level: RoutineLevel | 'OFF') =>
    setSelection((s) => {
      const routines = { ...s.routines };
      if (level === 'OFF') delete routines[key];
      else routines[key] = level;
      return { ...s, routines };
    });

  const preset = matchingPreset(catalogue, selection);
  const levels = catalogue.routines.map((r): RoutineLevel | 'OFF' => selection.routines[r.key] ?? 'OFF');
  const bulk = levels.every((l) => l === 'STAFF') ? 'STAFF' : levels.every((l) => l === 'MANAGER') ? 'MANAGER' : 'CUSTOM';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    if (mode === 'create') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setProblem('Enter a valid email address.');
      if (password.length < MIN_PASSWORD) return setProblem(`The password needs at least ${MIN_PASSWORD} characters.`);
    }
    if (!branch) return setProblem('Choose a branch, or Corporate for every branch.');
    setProblem(null);
    onSubmit({
      ...(mode === 'create' ? { email: email.trim(), password } : {}),
      user_type: userType,
      corporate: branch === CORPORATE,
      ...(branch === CORPORATE ? {} : { branch_id: branch }),
      access: selection,
    });
  };

  const sectionHead = (key: string, title: string, master?: { checked: boolean; onChange: (v: boolean) => void }) => (
    <div className={styles.sectionHead}>
      <span className={styles.sectionIcon} data-tone={SECTION_LOOK[key]?.tone ?? 'green'}>
        <AppIcon name={SECTION_LOOK[key]?.icon ?? 'grid'} size={20} />
      </span>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {master ? <Switch label={`All of ${title}`} checked={master.checked} onChange={master.onChange} /> : null}
    </div>
  );

  const routinesAndTasks = (
    <>
      <section className={styles.section} aria-label="Routines (Daily Forms)">
        {sectionHead('routines', 'Routines (Daily Forms)')}
        <p className={styles.bulkLabel}>Bulk mode</p>
        <Segmented
          label="Bulk mode"
          value={bulk}
          options={[
            { value: 'STAFF', label: 'Staff', icon: 'person' },
            { value: 'CUSTOM', label: 'Custom', icon: 'sliders' },
            { value: 'MANAGER', label: 'Manager', icon: 'people' },
          ]}
          onChange={(value) => {
            if (value === 'CUSTOM') return;
            setSelection((s) => ({
              ...s,
              routines: Object.fromEntries(catalogue.routines.map((r) => [r.key, value])),
            }));
          }}
        />
        {catalogue.routines.map((routine) => {
          const level: RoutineLevel | 'OFF' = selection.routines[routine.key] ?? 'OFF';
          return (
            <div key={routine.key} className={styles.routineRow}>
              <span className={`${styles.routineLabel} ${level === 'OFF' ? styles.routineLabelOff : ''}`}>
                {routine.label}
              </span>
              <div className={styles.levels} role="radiogroup" aria-label={routine.label}>
                {(['OFF', 'STAFF', 'MANAGER'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={level === l}
                    data-level={l}
                    className={styles.level}
                    onClick={() => setRoutine(routine.key, l)}
                  >
                    {l === 'OFF' ? 'Off' : l === 'STAFF' ? 'Staff' : 'Manager'}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className={styles.section} aria-label="Tasks Module">
        {sectionHead('tasks', 'Tasks Module')}
        <Segmented<TaskMode>
          label="Tasks Module"
          value={selection.tasks}
          options={[
            { value: 'OFF', label: 'Off', icon: 'minusCircle' },
            { value: 'RECEIVE', label: 'Receive', icon: 'inbox' },
            { value: 'BOTH', label: 'Both', icon: 'transfer' },
          ]}
          onChange={(tasks) => setSelection((s) => ({ ...s, tasks }))}
        />
      </section>
    </>
  );

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <h2 className={styles.formTitle}>{mode === 'create' ? 'Create New User' : 'Edit User'}</h2>

      <label className={styles.label} htmlFor="user-email">
        Email Address
      </label>
      <div className={styles.field}>
        <AppIcon name="mail" size={24} />
        {mode === 'create' ? (
          <input
            id="user-email"
            className={styles.input}
            type="email"
            autoComplete="off"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <input id="user-email" className={`${styles.input} ${styles.readonly}`} value={fixedEmail ?? ''} readOnly />
        )}
      </div>

      {mode === 'create' ? (
        <>
          <label className={styles.label} htmlFor="user-password">
            Password
          </label>
          <div className={styles.field}>
            <AppIcon name="lock" size={24} />
            <input
              id="user-password"
              className={styles.input}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={`Min ${MIN_PASSWORD} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className={styles.eye}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              <AppIcon name={showPassword ? 'eye' : 'eyeOff'} size={24} />
            </button>
          </div>
        </>
      ) : null}

      <span className={styles.label}>Branch</span>
      <Dropdown
        label="Branch"
        placeholder="Select branch"
        value={branch}
        options={[
          { value: CORPORATE, label: 'Corporate (all branches)' },
          ...catalogue.branches.map((b) => ({ value: b.id, label: b.name })),
        ]}
        onChange={setBranch}
      />

      <span className={styles.label}>Quick Set User Type</span>
      <Dropdown<UserType | 'CUSTOM'>
        label="Quick Set User Type"
        value={preset ?? 'CUSTOM'}
        options={[
          { value: 'CUSTOM', label: 'Custom' },
          { value: 'ADMIN', label: 'Admin' },
          { value: 'MANAGER', label: 'Manager' },
          { value: 'STAFF', label: 'Staff' },
        ]}
        onChange={(value) => {
          if (value === 'CUSTOM') return;
          setUserType(value);
          const p = catalogue.presets[value];
          setSelection({ toggles: [...p.toggles], routines: { ...p.routines }, tasks: p.tasks });
        }}
      />
      <p className={styles.hint}>
        Saved as {USER_TYPE_LABEL[userType]}
        {userType === 'ADMIN' ? ' — also manages users, branches and settings' : ''}.
      </p>

      <h2 className={styles.permissionsTitle}>Permissions</h2>
      {notice ? <p className={styles.hint}>{notice}</p> : null}

      {catalogue.sections.map((section) => {
        const keys = section.toggles.map((t) => t.key);
        const all = keys.every((k) => on.has(k));
        return (
          <div key={section.key}>
            <section className={styles.section} aria-label={section.title}>
              {sectionHead(section.key, section.title, { checked: all, onChange: (v) => setToggles(keys, v) })}
              {section.toggles.map((t) => (
                <div key={t.key} className={styles.row}>
                  <span className={styles.rowLabel}>{t.label}</span>
                  <Switch label={t.label} small checked={on.has(t.key)} onChange={(v) => setToggles([t.key], v)} />
                </div>
              ))}
            </section>
            {section.key === AFTER_BANQUET ? routinesAndTasks : null}
          </div>
        );
      })}

      {problem || locked ? (
        <p className={styles.error} role="alert">
          {problem ?? locked}
        </p>
      ) : null}
      <button type="submit" className={styles.submit} disabled={busy || !!locked}>
        {busy ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
      </button>
    </form>
  );
}

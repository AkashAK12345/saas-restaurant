'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { describeDevice, settingsApi, type SessionEntry } from '@/lib/settings/api';
import { deviceTimeZone, formatDateTime } from '@/lib/format/datetime';
import styles from '@/components/settings/settings.module.css';

/**
 * Signed-in devices — the reference system's "logged devices" with remote
 * logout.
 *
 * Every operator can see and end their OWN logins; nothing here reaches
 * anyone else's. Signing a device out takes effect on its very next request
 * (the server checks the session behind every access token). The device in
 * hand is labelled and not offered here: signing out of it is the menu's job.
 */
export default function SignedInDevicesPage() {
  const { selectedBranch } = useAppContext();
  const tz = selectedBranch?.timezone ?? deviceTimeZone();
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await settingsApi.sessions();
      setSessions(res.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your devices');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const signOut = async (session: SessionEntry) => {
    setBusy(session.handle);
    setNotice(null);
    setError(null);
    try {
      await settingsApi.revokeSession(session.handle);
      setNotice(`Signed out ${describeDevice(session.user_agent)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign that device out');
    } finally {
      await load();
      setBusy(null);
    }
  };

  return (
    <section className={styles.page}>
      <header>
        <h1>Signed-in devices</h1>
        <p className={styles.intro}>
          Everywhere you are signed in to SAMCO. If you do not recognise a device, sign it out and change your
          password.
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

      {sessions === null ? (
        error ? null : (
          <p role="status" aria-live="polite">
            Loading your devices…
          </p>
        )
      ) : (
        <ul className={styles.list}>
          {sessions.map((s) => (
            <li key={s.handle} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.title}>{describeDevice(s.user_agent)}</span>
                {s.current ? <span className={styles.badge}>This device</span> : null}
                <span className={styles.spacer} />
                {s.current ? null : (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.danger}`}
                    disabled={busy !== null}
                    aria-label={`Sign out ${describeDevice(s.user_agent)}`}
                    onClick={() => void signOut(s)}
                  >
                    {busy === s.handle ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </div>
              <div className={styles.meta}>
                Last active {formatDateTime(s.last_used_at ?? s.created_at, tz)} · signed in{' '}
                {formatDateTime(s.created_at, tz)}
                {s.ip_address ? ` · ${s.ip_address}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

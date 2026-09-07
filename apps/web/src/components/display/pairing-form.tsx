'use client';

import { useState } from 'react';
import { isWellFormedCredential, type DeviceSession } from '@/lib/display/device-session';
import styles from './display.module.css';

/**
 * One-time pairing for a screen.
 *
 * This is NOT a staff login: there is no email, no password, no session and
 * no navigation into the application. A manager pairs the device once in the
 * staff app (which shows the credential exactly once) and enters it here; the
 * device then speaks for itself from then on.
 *
 * The credential is typed into a password field, never echoed back after it is
 * stored, and never placed in a URL.
 */
export function PairingForm({
  onPair,
  error,
}: {
  onPair: (session: DeviceSession) => void;
  error?: string | null;
}) {
  const [credential, setCredential] = useState('');
  const [branchId, setBranchId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const cred = credential.trim();
    const branch = branchId.trim();
    if (!isWellFormedCredential(cred)) {
      setLocalError('That does not look like a device credential.');
      return;
    }
    if (!branch) {
      setLocalError('Enter the branch this screen belongs to.');
      return;
    }
    setLocalError(null);
    onPair({ credential: cred, branchId: branch });
  };

  return (
    <form
      className={styles.pair}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h1 className={styles.pairTitle}>Pair this screen</h1>

      {(localError ?? error) ? (
        <p role="alert" className={styles.pairError}>
          {localError ?? error}
        </p>
      ) : null}

      <div>
        <label className={styles.pairLabel} htmlFor="pair-branch">
          Branch ID
        </label>
        <input
          id="pair-branch"
          className={styles.pairInput}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div>
        <label className={styles.pairLabel} htmlFor="pair-credential">
          Device credential
        </label>
        <input
          id="pair-credential"
          className={styles.pairInput}
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <button type="submit" className={styles.pairButton}>
        Pair screen
      </button>
      <p className={styles.pairHint}>
        Shown once when the device is paired in Displays. If it is lost, revoke the device and pair again.
      </p>
    </form>
  );
}

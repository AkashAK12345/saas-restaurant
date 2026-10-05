'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { ApiError } from '@/lib/api/client';
import { Logo } from '@/components/brand/logo';
import { safeNextPath } from '@/lib/auth/next-path';
import styles from './login.module.css';

/**
 * Read at the moment of navigation rather than during render, so the page
 * needs no search-params hook (and no suspense boundary) to be prerendered.
 */
function nextFromAddressBar(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. back button) → straight to where they were going.
  useEffect(() => {
    if (status === 'authenticated') router.replace(nextFromAddressBar());
  }, [status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.replace(nextFromAddressBar());
    } catch (err) {
      // The backend's message is generic by design ("Invalid credentials",
      // "Too many failed login attempts…"); show it verbatim.
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <div className={styles.brand}>
        <Logo variant="full" height={96} />
      </div>
      <h1>Sign in</h1>

      <label className={styles.field}>
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </label>

      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>

      <Link href="/forgot-password" className={styles.forgot}>
        Forgot password?
      </Link>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <button type="submit" className={styles.submit} disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

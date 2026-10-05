'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api/client';
import { Logo } from '@/components/brand/logo';
import styles from '../login/login.module.css';

const MIN_PASSWORD = 8;
const RESEND_SECONDS = 60;

type Step = 'email' | 'code' | 'done';

/**
 * "Forgot password": email → a 6-digit code by email → a new password.
 *
 * The server answers every email the same way and only ever sends a code to
 * the owner account, so this screen never says whether an account exists.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.public<{ message: string }>('/auth/password-recovery/request', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setNotice(res.message);
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(message(e, 'Could not send the code. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter your email address.');
    await sendCode();
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email.');
    if (password.length < MIN_PASSWORD) return setError(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setError(null);
    setBusy(true);
    try {
      await api.public('/auth/password-recovery/reset', {
        method: 'POST',
        body: { email: email.trim(), code, new_password: password },
      });
      setStep('done');
    } catch (err) {
      setError(message(err, 'Could not reset the password. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.brand}>
        <Logo variant="full" height={96} />
      </div>

      {step === 'email' ? (
        <form onSubmit={onRequest} className={styles.form} noValidate>
          <h1>Forgot password</h1>
          <p className={styles.hint}>Enter your email and we will send you a 6-digit code to set a new password.</p>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.submit} disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form onSubmit={onReset} className={styles.form} noValidate>
          <h1>Enter the code</h1>
          {notice ? (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          ) : null}
          <label className={styles.field}>
            <span>6-digit code</span>
            <input
              className={styles.code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            <span>New password</span>
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={`Min ${MIN_PASSWORD} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            <span>Confirm new password</span>
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className={styles.hint}>
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
          </label>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
          <button type="button" className={styles.secondary} disabled={busy || wait > 0} onClick={() => void sendCode()}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        </form>
      ) : null}

      {step === 'done' ? (
        <>
          <h1>Password changed</h1>
          <p role="status" className={styles.notice}>
            Your password has been changed and every device has been signed out. Sign in with the new password.
          </p>
          <Link href="/login" className={styles.submit} style={{ display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)' }}>
            Sign in
          </Link>
        </>
      ) : null}

      {step !== 'done' ? (
        <Link href="/login" className={styles.back}>
          Back to sign in
        </Link>
      ) : null}
    </div>
  );
}

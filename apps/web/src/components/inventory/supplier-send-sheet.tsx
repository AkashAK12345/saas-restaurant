'use client';

import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import { whatsappLink } from '@/lib/inventory/purchase-orders';
import { saveFile } from '@/lib/reports/api';
import styles from './send-order.module.css';

/**
 * "Send to <supplier>" for a statement: the summary as a WhatsApp message,
 * then the statement PDF into the same chat. Nothing is recorded — a
 * statement changes no order — so the steps only tick off what was done.
 */
export function SupplierSendSheet({
  name,
  phone,
  message,
  pdf,
  onClose,
}: {
  name: string;
  phone: string | null;
  message: string;
  /** Fetches the statement PDF to share. */
  pdf: () => Promise<{ blob: Blob; filename: string }>;
  onClose: () => void;
}) {
  const [sentMessage, setSentMessage] = useState(false);
  const [sentPdf, setSentPdf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sendMessage = () => {
    window.open(whatsappLink(phone, message), '_blank');
    setSentMessage(true);
  };

  const sendPdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await pdf();
      const file = new File([blob], filename, { type: 'application/pdf' });
      // A phone shares the file straight into WhatsApp; elsewhere it is saved to attach.
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Statement for ${name}` });
      } else {
        saveFile({ blob, filename });
      }
      setSentPdf(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : 'Could not prepare the statement');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="send-statement-title">
      <header className={styles.head}>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <AppIcon name="close" size={26} />
        </button>
        <h2 className={styles.title} id="send-statement-title">
          Send to {name}
        </h2>
      </header>

      <div className={styles.body}>
        <p className={styles.info}>
          <AppIcon name="info" size={20} />
          WhatsApp can&apos;t attach a file and a message together, so send them one after the other — both land in the
          same chat. Confirm each one so nothing is recorded as sent by mistake.
        </p>
        <div className={styles.step}>
          <div className={styles.stepMain}>
            <span className={styles.num} data-done={sentMessage}>
              {sentMessage ? <AppIcon name="check" size={20} /> : '1'}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>Send message</span>
              <span className={styles.stepSub}>Opens {name}&apos;s chat with the summary ready to send.</span>
            </span>
            <button type="button" className={styles.go} onClick={sendMessage}>
              Send message
            </button>
          </div>
        </div>
        <div className={styles.step}>
          <div className={styles.stepMain}>
            <span className={styles.num} data-done={sentPdf}>
              {sentPdf ? <AppIcon name="check" size={20} /> : '2'}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>Send PDF</span>
              <span className={styles.stepSub}>Shares the full statement PDF — pick the same chat.</span>
            </span>
            <button type="button" className={styles.go} disabled={busy} onClick={() => void sendPdf()}>
              {busy ? 'Preparing…' : 'Send PDF'}
            </button>
          </div>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <p className={styles.footNote}>Nothing about this send is recorded on the orders.</p>
        <button type="button" className={styles.done} onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/app/icons';
import type { InventoryContext } from '@/lib/inventory/api';
import { orderMessage, purchaseOrdersApi, whatsappLink, type OrderDetail } from '@/lib/inventory/purchase-orders';
import { saveFile } from '@/lib/reports/api';
import styles from './send-order.module.css';

/** idle → opened (waiting to be confirmed) → done; the message may be skipped. */
type Step = 'idle' | 'opened' | 'done' | 'skipped';

/**
 * "Send to <supplier>" — WhatsApp cannot take a file and a message together,
 * so the order goes in two steps into the same chat: the item list as a
 * message, then the order PDF. Each step is confirmed by the sender, and the
 * order is marked sent only once the PDF is confirmed — the PDF is the order.
 */
export function SendOrderSheet({
  ctx,
  orderId,
  known,
  onClose,
  onSent,
}: {
  ctx: InventoryContext;
  orderId: string;
  /** The order when the caller already holds it. */
  known?: OrderDetail;
  onClose: () => void;
  onSent: (order: OrderDetail) => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(known ?? null);
  const [message, setMessage] = useState<Step>('idle');
  const [pdf, setPdf] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    purchaseOrdersApi
      .get(ctx, orderId)
      .then((o) => !cancelled && setOrder(o))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the order'));
    return () => {
      cancelled = true;
    };
  }, [ctx, orderId, known]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sendMessage = () => {
    if (!order) return;
    window.open(whatsappLink(order.vendor.phone, orderMessage(order)), '_blank');
    setMessage('opened');
  };

  const sendPdf = async () => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const { blob } = await purchaseOrdersApi.pdf(ctx, order.id);
      const filename = `${order.po_number}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });
      // A phone shares the file straight into WhatsApp; elsewhere it is saved to attach.
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Purchase order ${order.po_number}` });
      } else {
        saveFile({ blob, filename });
      }
      setPdf('opened');
    } catch (e) {
      // Closing the share sheet is not a failure; nothing went.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : 'Could not prepare the PDF');
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!order) return onClose();
    if (pdf !== 'done' || order.status !== 'ORDERED' || !order.may_edit) return onClose();
    setBusy(true);
    setError(null);
    try {
      onSent(await purchaseOrdersApi.markSent(ctx, order.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark the order sent');
      setBusy(false);
    }
  };

  const confirm = (set: (s: Step) => void, what: string) => (
    <div className={styles.confirm}>
      <span>Did the {what} go?</span>
      <button type="button" onClick={() => set('idle')}>
        Not yet
      </button>
      <button type="button" data-yes onClick={() => set('done')}>
        Yes, sent
      </button>
    </div>
  );

  const name = order?.vendor.name ?? 'supplier';

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-labelledby="send-order-title">
      <header className={styles.head}>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <AppIcon name="close" size={26} />
        </button>
        <h2 className={styles.title} id="send-order-title">
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
            <span className={styles.num} data-done={message === 'done'}>
              {message === 'done' ? <AppIcon name="check" size={20} /> : '1'}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>Send message</span>
              <span className={styles.stepSub}>
                {message === 'skipped' ? 'Skipped — the PDF alone.' : `Opens ${name}'s chat with the item list ready to send.`}
              </span>
            </span>
            <button type="button" className={styles.go} disabled={!order} onClick={sendMessage}>
              Send message
            </button>
          </div>
          {message === 'opened' ? confirm(setMessage, 'message') : null}
        </div>
        {message === 'idle' ? (
          <button type="button" className={styles.skip} onClick={() => setMessage('skipped')}>
            Skip message — send PDF only
          </button>
        ) : null}

        <div className={styles.step}>
          <div className={styles.stepMain}>
            <span className={styles.num} data-done={pdf === 'done'}>
              {pdf === 'done' ? <AppIcon name="check" size={20} /> : '2'}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>Send PDF</span>
              <span className={styles.stepSub}>Shares the order PDF — pick the same chat.</span>
            </span>
            <button type="button" className={styles.go} disabled={!order || busy} onClick={() => void sendPdf()}>
              {busy && pdf === 'idle' ? 'Preparing…' : 'Send PDF'}
            </button>
          </div>
          {pdf === 'opened' ? confirm(setPdf, 'PDF') : null}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <p className={styles.footNote}>
          {pdf === 'done' ? 'The PDF went: Done marks the order sent.' : 'Not marked sent until you confirm the PDF went — that’s the order.'}
        </p>
        <button type="button" className={styles.done} disabled={busy} onClick={() => void finish()}>
          Done
        </button>
      </footer>
    </div>
  );
}

/**
 * /display/queue — foundation placeholder.
 *
 * Phase 7 will render the customer/admin queue board here, driven by the
 * StreamClient (`@/lib/realtime/sse-client`) with tickets from
 * POST /display/stream-tickets. No staff UI, no navigation, no session.
 */
export default function QueueDisplayPage() {
  return (
    <main aria-label="Queue display">
      <h1>Queue display</h1>
      <p>Awaiting pairing and configuration.</p>
    </main>
  );
}

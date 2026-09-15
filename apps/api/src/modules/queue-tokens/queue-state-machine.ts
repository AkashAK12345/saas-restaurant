import { QueueTokenStatus } from '@samco/database';

/**
 * Queue token lifecycle — the single definition of which status changes are
 * legal. QueueTokensService consults this before every mutation; nothing else
 * writes `status`.
 *
 *   SCHEDULED ─▶ WAITING ─▶ CALLED ─▶ SEATED
 *       │           ▲          ├────▶ NO_SHOW
 *       │           └── skip ──┤
 *       └───────────┴──────────┴────▶ CANCELLED
 *
 * SCHEDULED is an advance booking that has not surfaced yet. It becomes
 * WAITING when staff check the party in, or automatically at the booked time.
 *
 * CALLED ─▶ WAITING is SKIP: the party did not respond and goes back to the
 * waiting list (behind everyone not yet called — see QueueTokensService). The
 * reference product names this state "skipped"; it is modelled as an event on
 * a transition rather than a separate status because a skipped party is, in
 * every operational sense, waiting again.
 *
 * SEATED, NO_SHOW and CANCELLED are terminal.
 */
export const QUEUE_TRANSITIONS: Readonly<
  Record<QueueTokenStatus, readonly QueueTokenStatus[]>
> = {
  [QueueTokenStatus.SCHEDULED]: [QueueTokenStatus.WAITING, QueueTokenStatus.CANCELLED],
  [QueueTokenStatus.WAITING]: [QueueTokenStatus.CALLED, QueueTokenStatus.CANCELLED],
  [QueueTokenStatus.CALLED]: [
    QueueTokenStatus.SEATED,
    QueueTokenStatus.NO_SHOW,
    QueueTokenStatus.CANCELLED,
    QueueTokenStatus.WAITING,
  ],
  [QueueTokenStatus.SEATED]: [],
  [QueueTokenStatus.NO_SHOW]: [],
  [QueueTokenStatus.CANCELLED]: [],
};

/** A walk-in joins the live queue. */
export const INITIAL_QUEUE_STATUS = QueueTokenStatus.WAITING;

/** An advance booking is held until its time. */
export const INITIAL_SCHEDULED_STATUS = QueueTokenStatus.SCHEDULED;

/** Statuses a token can still hold a place in the live queue from. */
export const ACTIVE_QUEUE_STATUSES: readonly QueueTokenStatus[] = [
  QueueTokenStatus.WAITING,
  QueueTokenStatus.CALLED,
];

export function isTerminalQueueStatus(status: QueueTokenStatus): boolean {
  return QUEUE_TRANSITIONS[status].length === 0;
}

export function canTransition(from: QueueTokenStatus, to: QueueTokenStatus): boolean {
  return QUEUE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Domain error for an illegal status change. It is NOT an HTTP exception:
 * the service translates it to a controlled 409 so the state machine stays
 * transport-agnostic.
 */
export class InvalidQueueTransitionError extends Error {
  constructor(
    readonly from: QueueTokenStatus,
    readonly to: QueueTokenStatus,
  ) {
    super(`Cannot move a queue token from ${from} to ${to}`);
    this.name = 'InvalidQueueTransitionError';
  }
}

export function assertTransition(from: QueueTokenStatus, to: QueueTokenStatus): void {
  if (!canTransition(from, to)) throw new InvalidQueueTransitionError(from, to);
}

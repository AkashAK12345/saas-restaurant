import { QueueTokenStatus } from '@samco/database';

/**
 * Queue token lifecycle — the single definition of which status changes are
 * legal. QueueTokensService consults this before every mutation; nothing else
 * writes `status`.
 *
 *   WAITING ─▶ CALLED ─▶ SEATED
 *      │          ├────▶ NO_SHOW
 *      └──────────┴────▶ CANCELLED
 *
 * SEATED, NO_SHOW and CANCELLED are terminal. There is deliberately no
 * "recall" transition (CALLED ─▶ WAITING or CALLED ─▶ CALLED): the repository
 * carries no product definition of recall, so re-announcing a party is left
 * to the podium operator calling the next token rather than being invented
 * here. If the product introduces recall, the exact transition belongs in
 * this table, with its own tests, not as an ad-hoc status write.
 */
export const QUEUE_TRANSITIONS: Readonly<
  Record<QueueTokenStatus, readonly QueueTokenStatus[]>
> = {
  [QueueTokenStatus.WAITING]: [QueueTokenStatus.CALLED, QueueTokenStatus.CANCELLED],
  [QueueTokenStatus.CALLED]: [
    QueueTokenStatus.SEATED,
    QueueTokenStatus.NO_SHOW,
    QueueTokenStatus.CANCELLED,
  ],
  [QueueTokenStatus.SEATED]: [],
  [QueueTokenStatus.NO_SHOW]: [],
  [QueueTokenStatus.CANCELLED]: [],
};

export const INITIAL_QUEUE_STATUS = QueueTokenStatus.WAITING;

/** Statuses a token can still hold a place in the queue from. */
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

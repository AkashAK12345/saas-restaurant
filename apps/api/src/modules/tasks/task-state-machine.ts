import { TaskStatus } from '@samco/database';

/**
 * Task lifecycle — the single definition of which status changes are legal.
 * TasksService consults this before every mutation; nothing else writes
 * `status`, and there is no PATCH route that could.
 *
 *   PENDING ─▶ IN_PROGRESS ─▶ COMPLETED
 *      │             └───────▶ CANCELLED
 *      ├──────────────────────▶ COMPLETED
 *      └──────────────────────▶ CANCELLED
 *
 * The roadmap does not define a lifecycle, so this is the smallest one that
 * works, and the choices are documented rather than assumed:
 *
 *   PENDING → COMPLETED is allowed. Plenty of operational tasks ("bin the
 *     grease trap") are done in one motion, and forcing a pointless "start"
 *     tap on a tablet would only teach staff to double-tap. The same shortcut
 *     exists on the Phase 8 kitchen items, for the same reason.
 *
 *   COMPLETED and CANCELLED are terminal. A finished task is never reopened:
 *     that would rewrite what happened. Repeat work is a new task — which is
 *     also exactly what a routine produces tomorrow.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.CANCELLED]: [],
};

export const INITIAL_TASK_STATUS = TaskStatus.PENDING;

/** Statuses where the work is still outstanding — what a dashboard counts as "open". */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
];

export function isOpen(status: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status);
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status]?.length === 0;
}

/** Details and assignment may only change while the work is still open. */
export function isEditable(status: TaskStatus): boolean {
  return isOpen(status);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Domain error for an illegal status change. NOT an HTTP exception: the
 * service maps it to a controlled 409 so the machine stays transport-agnostic.
 */
export class InvalidTaskTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Cannot move a task from ${from} to ${to}`);
    this.name = 'InvalidTaskTransitionError';
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) throw new InvalidTaskTransitionError(from, to);
}

/** Raised when required checklist items are still outstanding. */
export class ChecklistIncompleteError extends Error {
  constructor(readonly outstanding: number) {
    super(
      `${outstanding} required checklist ${outstanding === 1 ? 'item is' : 'items are'} still outstanding`,
    );
    this.name = 'ChecklistIncompleteError';
  }
}

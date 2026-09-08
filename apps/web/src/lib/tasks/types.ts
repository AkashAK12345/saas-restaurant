/**
 * Tasks & Routines (Phase 9) response shapes, hand-mirrored from
 * apps/api/src/modules/tasks — the same convention as the queue and banquet
 * type modules.
 *
 * The `tasks` realtime channel is staff-only (T0-B maps no display kind to
 * it), so payloads may name the member of staff responsible. They still carry
 * no email and no checklist labels — progress only.
 */

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type TaskSource = 'MANUAL' | 'ROUTINE';
export type RoutineFrequency = 'DAILY' | 'WEEKLY';
export type RoutineStatus = 'ACTIVE' | 'INACTIVE';
export type ChecklistTemplateStatus = 'ACTIVE' | 'INACTIVE';

export interface StaffRef {
  id: string;
  name: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  position: number;
  is_required: boolean;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
}

export interface ChecklistProgress {
  total: number;
  done: number;
  required_total: number;
  required_done: number;
  /** Server's verdict: every required item is ticked. */
  ready_to_complete: boolean;
}

export interface Task {
  id: string;
  company_id: string;
  branch_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  overdue: boolean;
  assignee_id: string | null;
  assignee: StaffRef | null;
  source: TaskSource;
  routine_id: string | null;
  routine_name: string | null;
  routine_occurrence_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completer: StaffRef | null;
  cancelled_at: string | null;
  checklist_progress: ChecklistProgress;
  created_at: string;
  updated_at: string;
}

export interface TaskDetail extends Task {
  checklist: ChecklistItem[];
}

export interface ChecklistTemplateItem {
  id: string;
  label: string;
  position: number;
  is_required: boolean;
}

export interface ChecklistTemplate {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  status: ChecklistTemplateStatus;
  items: ChecklistTemplateItem[];
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  description: string | null;
  frequency: RoutineFrequency;
  time_of_day: string;
  weekdays: number[];
  priority: TaskPriority;
  status: RoutineStatus;
  checklist_template_id: string | null;
  checklist_name: string | null;
  default_assignee_id: string | null;
  default_assignee: StaffRef | null;
  next_occurrence_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSummary {
  branch_id: string;
  from: string;
  to: string;
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    overdue: number;
  };
  completion_rate: number;
  by_routine: Array<{
    routine_id: string | null;
    routine_name: string;
    total: number;
    completed: number;
    completion_rate: number;
  }>;
  by_assignee: Array<{
    assignee_id: string | null;
    assignee_name: string;
    total: number;
    completed: number;
    completion_rate: number;
  }>;
}

export interface MaterializeResult {
  created: number;
  skipped: number;
  routines: number;
}

/** Realtime event names on the `tasks` channel. */
export const TASK_EVENTS = [
  'task.created',
  'task.assigned',
  'task.started',
  'task.completed',
  'task.cancelled',
  'task.checklist.updated',
  'task.routine.materialized',
] as const;

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
};

export const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

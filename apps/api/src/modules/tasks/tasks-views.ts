import type {
  ChecklistItemKind,
  ChecklistTemplateStatus,
  RoutineFrequency,
  RoutineStatus,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '@samco/database';

/**
 * Task projections.
 *
 * The `tasks` realtime channel is STAFF-ONLY — T0-B maps no display kind to
 * it, so no unattended screen can subscribe. Payloads may therefore name the
 * member of staff a task is assigned to. They still carry the minimum: an id
 * and a display name, never an email, and never anything about a customer.
 */

export interface StaffRefView {
  id: string;
  name: string;
}

export interface ChecklistItemView {
  id: string;
  label: string;
  position: number;
  /** CHECK is a tick; other kinds are done when answered. */
  kind: ChecklistItemKind;
  is_required: boolean;
  is_done: boolean;
  /** The canonical answer for a non-CHECK item; null while unanswered. */
  value: string | null;
  done_at: Date | null;
  done_by: string | null;
}

/**
 * A routine's "transposed log": checklist items down the side, occurrence
 * dates across the top. The reference system's compliance view — it shows a
 * restroom check failed three weeks running at a glance.
 */
export interface RoutineLogView {
  routine_id: string;
  routine_name: string;
  from: string;
  to: string;
  /** Branch-local occurrence dates that have a task, oldest first. */
  dates: string[];
  occurrences: Array<{ date: string; task_id: string; status: string; completed_at: Date | null; late: boolean }>;
  rows: Array<{
    label: string;
    kind: ChecklistItemKind;
    /** Keyed by date; absent when that occurrence did not have this item. */
    cells: Record<string, { done: boolean; value: string | null }>;
  }>;
}

export interface ChecklistProgressView {
  total: number;
  done: number;
  required_total: number;
  required_done: number;
  /** True when every REQUIRED item is ticked — the completion gate. */
  ready_to_complete: boolean;
}

export interface TaskView {
  id: string;
  company_id: string;
  branch_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: Date | null;
  /** True when the task is still open and its due time has passed. */
  overdue: boolean;
  assignee_id: string | null;
  assignee: StaffRefView | null;
  /** Who made the current assignment, and when. */
  assigned_by: string | null;
  assigner: StaffRefView | null;
  assigned_at: Date | null;
  /** Times responsibility moved from one person to another. */
  reassignment_count: number;
  /** Who raised the task; null for routine-generated tasks. */
  created_by: string | null;
  creator: StaffRefView | null;
  source: TaskSource;
  routine_id: string | null;
  routine_name: string | null;
  routine_occurrence_date: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  completed_by: string | null;
  completer: StaffRefView | null;
  cancelled_at: Date | null;
  checklist_progress: ChecklistProgressView;
  created_at: Date;
  updated_at: Date;
}

export interface TaskDetailView extends TaskView {
  checklist: ChecklistItemView[];
}

/** A note on a task. REST only, behind the same visibility as the task. */
export interface TaskCommentView {
  id: string;
  task_id: string;
  author: StaffRefView;
  body: string;
  created_at: Date;
}

export interface ChecklistTemplateItemView {
  id: string;
  label: string;
  position: number;
  kind: ChecklistItemKind;
  is_required: boolean;
}

export interface ReferenceChecklistView {
  key: string;
  name: string;
  description: string;
  items: Array<{ label: string; kind: ChecklistItemKind; is_required: boolean }>;
  /** A template with this name already exists in the company. */
  installed: boolean;
}

export interface ChecklistTemplateView {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  status: ChecklistTemplateStatus;
  items: ChecklistTemplateItemView[];
  created_at: Date;
  updated_at: Date;
}

export interface RoutineView {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  description: string | null;
  frequency: RoutineFrequency;
  time_of_day: string;
  /** Branch-local submission deadline, "HH:MM"; null = due at time_of_day. */
  due_time: string | null;
  weekdays: number[];
  priority: TaskPriority;
  status: RoutineStatus;
  checklist_template_id: string | null;
  checklist_name: string | null;
  default_assignee_id: string | null;
  default_assignee: StaffRefView | null;
  /** Branch-local, derived — never stored. Null when the routine is inactive. */
  next_occurrence_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Phase 9 completion reporting: counts and rates for the tasks module itself.
 * Deliberately NOT a generic report — no provider registry, no cross-module
 * aggregation, no export. Phase 10 owns that.
 */
export interface TaskSummaryView {
  branch_id: string;
  from: Date;
  to: Date;
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    overdue: number;
  };
  /** completed ÷ (total − cancelled), 0–100, one decimal. */
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

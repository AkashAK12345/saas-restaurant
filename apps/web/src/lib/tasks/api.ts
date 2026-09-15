import { api, apiDownload } from '@/lib/api/client';
import type { StreamTicketResponse } from '@/lib/api/types';
import type { Paginated } from '@/lib/queue/types';
import type {
  ChecklistItemKind,
  ChecklistTemplate,
  MaterializeResult,
  ReferenceChecklist,
  Routine,
  RoutineLog,
  RoutineFrequency,
  StaffRef,
  Task,
  TaskComment,
  TaskDetail,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from './types';

/**
 * Staff-side task calls, through the shared typed client. Tasks and routines
 * are branch-scoped; checklist templates are company-scoped and deliberately
 * send only X-Company-ID.
 */
export interface TaskContext {
  companyId: string;
  branchId: string;
}

const branch = (ctx: TaskContext) => ({ companyId: ctx.companyId, branchId: ctx.branchId });
const company = (ctx: TaskContext) => ({ companyId: ctx.companyId });

type QueryValue = string | number | boolean | undefined;

const qs = (params: Readonly<Record<string, QueryValue>> | TaskFilters) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as Array<[string, QueryValue]>) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  unassigned?: boolean;
  overdue?: boolean;
  routine_id?: string;
  limit?: number;
  offset?: number;
}

export const tasksApi = {
  list: (ctx: TaskContext, filters: TaskFilters = {}) =>
    api.get<Paginated<Task>>(`/tasks${qs(filters)}`, branch(ctx)),
  get: (ctx: TaskContext, id: string) => api.get<TaskDetail>(`/tasks/${id}`, branch(ctx)),

  create: (
    ctx: TaskContext,
    body: {
      title: string;
      description?: string;
      priority?: TaskPriority;
      due_at?: string;
      assignee_id?: string;
      checklist_template_id?: string;
    },
  ) => api.post<TaskDetail>('/tasks', body, branch(ctx)),

  update: (
    ctx: TaskContext,
    id: string,
    body: Partial<{ title: string; description: string | null; priority: TaskPriority; due_at: string | null }>,
  ) => api.patch<TaskDetail>(`/tasks/${id}`, body, branch(ctx)),

  /** Responsibility, not authorization — the API re-checks permissions regardless. */
  assign: (ctx: TaskContext, id: string, assigneeId: string | null) =>
    api.post<TaskDetail>(`/tasks/${id}/assign`, { assignee_id: assigneeId }, branch(ctx)),

  start: (ctx: TaskContext, id: string) =>
    api.post<TaskDetail>(`/tasks/${id}/start`, undefined, branch(ctx)),
  complete: (ctx: TaskContext, id: string) =>
    api.post<TaskDetail>(`/tasks/${id}/complete`, undefined, branch(ctx)),
  cancel: (ctx: TaskContext, id: string) =>
    api.post<TaskDetail>(`/tasks/${id}/cancel`, undefined, branch(ctx)),

  /** Tick/untick, or answer a typed item (the value is required to mark one done). */
  setChecklistItem: (ctx: TaskContext, id: string, itemId: string, isDone: boolean, value?: string) =>
    api.patch<TaskDetail>(
      `/tasks/${id}/checklist/${itemId}`,
      value !== undefined && isDone ? { is_done: isDone, value } : { is_done: isDone },
      branch(ctx),
    ),

  /** Transposed compliance log for a routine over branch-local dates. */
  routineLog: (ctx: TaskContext, routineId: string, from: string, to: string) =>
    api.get<RoutineLog>(`/routines/${routineId}/log${qs({ from, to })}`, branch(ctx)),

  /** The same window as a file; needs reports.export on top of tasks.reports.view. */
  exportRoutineLog: (ctx: TaskContext, routineId: string, from: string, to: string, format: 'xlsx' | 'pdf') =>
    apiDownload(`/routines/${routineId}/log/export${qs({ from, to, format })}`, `routine-log.${format}`, branch(ctx)),

  /** Who a task at this branch may be handed to — the same set the API accepts. */
  assignableStaff: (ctx: TaskContext) => api.get<StaffRef[]>('/tasks/assignable-staff', branch(ctx)),

  comments: (ctx: TaskContext, id: string) => api.get<TaskComment[]>(`/tasks/${id}/comments`, branch(ctx)),
  addComment: (ctx: TaskContext, id: string, body: string) =>
    api.post<TaskComment>(`/tasks/${id}/comments`, { body }, branch(ctx)),

  summary: (ctx: TaskContext, params: { from?: string; to?: string } = {}) =>
    api.get<TaskSummary>(`/tasks/summary${qs(params)}`, branch(ctx)),

  // Routines
  listRoutines: (ctx: TaskContext, limit = 100) =>
    api.get<Paginated<Routine>>(`/routines${qs({ limit })}`, branch(ctx)),
  createRoutine: (
    ctx: TaskContext,
    body: {
      name: string;
      description?: string;
      frequency: RoutineFrequency;
      time_of_day: string;
      due_time?: string;
      weekdays?: number[];
      priority?: TaskPriority;
      checklist_template_id?: string;
      default_assignee_id?: string;
    },
  ) => api.post<Routine>('/routines', body, branch(ctx)),
  updateRoutine: (ctx: TaskContext, id: string, body: Record<string, unknown>) =>
    api.patch<Routine>(`/routines/${id}`, body, branch(ctx)),
  activateRoutine: (ctx: TaskContext, id: string) =>
    api.post<Routine>(`/routines/${id}/activate`, undefined, branch(ctx)),
  deactivateRoutine: (ctx: TaskContext, id: string) =>
    api.post<Routine>(`/routines/${id}/deactivate`, undefined, branch(ctx)),
  /** Idempotent: safe to press twice, and safe if the scheduler is off. */
  materialize: (ctx: TaskContext) =>
    api.post<MaterializeResult>('/routines/materialize', undefined, branch(ctx)),

  // Checklist templates (company-scoped)
  listChecklists: (ctx: TaskContext, limit = 100) =>
    api.get<Paginated<ChecklistTemplate>>(`/checklists${qs({ limit })}`, company(ctx)),
  createChecklist: (
    ctx: TaskContext,
    body: {
      name: string;
      description?: string;
      items: Array<{ label: string; is_required?: boolean; kind?: ChecklistItemKind }>;
    },
  ) => api.post<ChecklistTemplate>('/checklists', body, company(ctx)),
  referenceLibrary: (ctx: TaskContext) => api.get<ReferenceChecklist[]>('/checklists/library', company(ctx)),
  installReference: (ctx: TaskContext, key: string) =>
    api.post<ChecklistTemplate>(`/checklists/library/${encodeURIComponent(key)}`, undefined, company(ctx)),
  updateChecklist: (ctx: TaskContext, id: string, body: Record<string, unknown>) =>
    api.patch<ChecklistTemplate>(`/checklists/${id}`, body, company(ctx)),

  /** Single-use, 60-second ticket for the tasks stream. */
  streamTicket: (ctx: TaskContext) =>
    api.post<StreamTicketResponse>('/realtime/tickets/tasks', undefined, branch(ctx)),
};

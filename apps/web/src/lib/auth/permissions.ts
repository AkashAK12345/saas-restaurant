/**
 * Permission keys the frontend refers to.
 *
 * THE BACKEND IS THE SOURCE OF TRUTH: `apps/api/src/common/authorization/
 * permission-keys.ts` defines every key and the seed loads them. This file is
 * a typed *reference* to a subset — it does not grant anything, and a key
 * listed here that the backend does not recognise is simply never present in
 * the effective permission set. Sharing the canonical list through a
 * workspace package is backlog.
 *
 * Only keys the foundation actually renders navigation for are listed.
 */
export const PERMISSION_KEYS = {
  CUSTOMERS_VIEW: 'customers.view',
  TABLES_VIEW: 'tables.view',
  DISPLAY_DEVICES_VIEW: 'display_devices.view',
  USERS_VIEW: 'users.view',
  ROLES_VIEW: 'roles.view',
  BRANCHES_VIEW: 'branches.view',
  AUDIT_LOGS_VIEW: 'audit_logs.view',
  QUEUE_VIEW: 'queue.view',
  BANQUET_KDS_VIEW: 'banquet.kds.view',
  TASKS_VIEW: 'tasks.view',
  /** Narrower task read: only the caller's own tasks. The server narrows the data. */
  TASKS_VIEW_OWN: 'tasks.view_own',
  // Queue Management (Phase 7) — one key per explicit queue operation.
  QUEUE_REGISTER: 'queue.register',
  QUEUE_CALL: 'queue.call',
  QUEUE_SEAT: 'queue.seat',
  QUEUE_NO_SHOW: 'queue.no_show',
  QUEUE_CANCEL: 'queue.cancel',
  // Banquet Management (Phase 8)
  BANQUET_VIEW: 'banquet.view',
  BANQUET_HALL_MANAGE: 'banquet.hall.manage',
  BANQUET_PACKAGE_MANAGE: 'banquet.package.manage',
  BANQUET_BOOKING_CREATE: 'banquet.booking.create',
  BANQUET_BOOKING_CONFIRM: 'banquet.booking.confirm',
  BANQUET_BOOKING_CANCEL: 'banquet.booking.cancel',
  BANQUET_BOOKING_COMPLETE: 'banquet.booking.complete',
  BANQUET_PAYMENT_CREATE: 'banquet.payment.create',
  BANQUET_EVENT_PLAN_MANAGE: 'banquet.event_plan.manage',
  BANQUET_KDS_MANAGE: 'banquet.kds.manage',
  BANQUET_PLATE_REQUEST: 'banquet.plate.request',
  BANQUET_FINANCE_VIEW: 'banquet.finance.view',
  // Tasks & Routines (Phase 9)
  TASKS_CREATE: 'tasks.create',
  TASKS_UPDATE: 'tasks.update',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_START: 'tasks.start',
  TASKS_COMPLETE: 'tasks.complete',
  TASKS_CANCEL: 'tasks.cancel',
  TASKS_CHECKLIST_MANAGE: 'tasks.checklist.manage',
  TASKS_ROUTINE_MANAGE: 'tasks.routine.manage',
  TASKS_REPORTS_VIEW: 'tasks.reports.view',
  // Point of sale: a branch's takings, granted on its own.
  POS_REPORTS_VIEW: 'pos.reports.view',
  // Purchasing: what a branch spends and with whom, granted on its own.
  PURCHASE_REPORTS_VIEW: 'purchase.reports.view',
  // Inventory: stock per branch, shown for every branch where it is held.
  INVENTORY_VIEW: 'inventory.view',
  // Reports & Dashboard (Phase 10). REPORTS_VIEW opens the catalogue; each
  // report additionally needs its own domain key, which the server checks.
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  DASHBOARD_VIEW: 'dashboard.view',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS] | (string & {});

/**
 * Does the effective permission set include the key?
 *
 * This is a UI convenience for hiding controls the server would reject. It is
 * NOT authorization: a control shown here can still be refused by the API,
 * and a control hidden here protects nothing on its own.
 */
export function hasPermission(effective: readonly string[] | undefined, key: PermissionKey): boolean {
  return !!effective && effective.includes(key);
}

export function hasAnyPermission(effective: readonly string[] | undefined, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => hasPermission(effective, k));
}

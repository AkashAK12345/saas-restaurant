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

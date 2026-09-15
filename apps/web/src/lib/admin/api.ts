import { api } from '@/lib/api/client';

/**
 * Administration calls: customers, tables, display devices, users, company
 * memberships and roles.
 *
 * Company-scoped calls send X-Company-ID; branch-scoped calls (tables, display
 * devices, branch-role assignment) also send X-Branch-ID. Headers are requested
 * context only — the API proves membership and permission on every call.
 *
 * No type here carries a credential: users never include a password hash, and
 * a display device's pairing credential exists only in the one-time response
 * of `createDisplayDevice`, which the page shows once and then discards.
 */

export interface Page<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export type ActiveStatus = 'ACTIVE' | 'INACTIVE';

export interface CustomerRecord {
  id: string;
  company_id: string;
  name: string;
  phone: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export interface TableRecord {
  id: string;
  branch_id: string;
  label: string;
  capacity: number;
  zone: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export type DisplayDeviceKind = 'QUEUE_CUSTOMER' | 'QUEUE_ADMIN' | 'BANQUET_CHEF';

export interface DisplayDeviceRecord {
  id: string;
  branch_id: string;
  name: string;
  kind: DisplayDeviceKind;
  status: 'ACTIVE' | 'REVOKED';
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRecord {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: ActiveStatus;
  created_at: string;
  updated_at: string;
}

export interface MemberRecord {
  id: string;
  user_id: string;
  company_id: string;
  status: ActiveStatus;
  created_at: string;
  user: { id: string; email: string; first_name: string | null; last_name: string | null };
}

export interface BranchRoleAssignment {
  id: string;
  branch: { id: string; name: string };
  role: { id: string; name: string };
}

export interface PermissionEntry {
  name: string;
  module: string;
  description: string | null;
}

export interface RoleRecord {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  permissions: Array<{ permission: { name: string; module: string } }>;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const adminApi = {
  // ── Customers (company) ────────────────────────────────────────────────────
  customers: (companyId: string, query: { q?: string; status?: ActiveStatus; limit: number; offset: number }) =>
    api.get<Page<CustomerRecord>>(`/customers${qs(query)}`, { companyId }),
  customer: (companyId: string, id: string) => api.get<CustomerRecord>(`/customers/${id}`, { companyId }),
  createCustomer: (companyId: string, body: { name: string; phone?: string }) =>
    api.post<CustomerRecord>('/customers', body, { companyId }),
  updateCustomer: (
    companyId: string,
    id: string,
    body: Partial<{ name: string; phone: string | null; status: ActiveStatus }>,
  ) => api.patch<CustomerRecord>(`/customers/${id}`, body, { companyId }),

  // ── Tables (branch) ────────────────────────────────────────────────────────
  tables: (companyId: string, branchId: string, query: { limit: number; offset: number }) =>
    api.get<Page<TableRecord>>(`/tables${qs(query)}`, { companyId, branchId }),
  createTable: (companyId: string, branchId: string, body: { label: string; capacity: number; zone?: string }) =>
    api.post<TableRecord>('/tables', body, { companyId, branchId }),
  updateTable: (
    companyId: string,
    branchId: string,
    id: string,
    body: Partial<{ label: string; capacity: number; zone: string | null; status: ActiveStatus }>,
  ) => api.patch<TableRecord>(`/tables/${id}`, body, { companyId, branchId }),

  // ── Display devices (branch) ───────────────────────────────────────────────
  displayDevices: (companyId: string, branchId: string, query: { limit: number; offset: number }) =>
    api.get<Page<DisplayDeviceRecord>>(`/display-devices${qs(query)}`, { companyId, branchId }),
  createDisplayDevice: (companyId: string, branchId: string, body: { name: string; kind: DisplayDeviceKind }) =>
    api.post<{ device: DisplayDeviceRecord; credential: string }>('/display-devices', body, { companyId, branchId }),
  revokeDisplayDevice: (companyId: string, branchId: string, id: string) =>
    api.post<DisplayDeviceRecord>(`/display-devices/${id}/revoke`, undefined, { companyId, branchId }),

  // ── Users and memberships (company; role assignment is branch) ─────────────
  users: (companyId: string) => api.get<UserRecord[]>('/users', { companyId }),
  members: (companyId: string) => api.get<MemberRecord[]>(`/companies/${companyId}/members`, { companyId }),
  createUser: (
    companyId: string,
    body: { email: string; password: string; first_name?: string; last_name?: string },
  ) => api.post<UserRecord>('/users', body, { companyId }),
  updateUser: (companyId: string, id: string, body: { first_name?: string; last_name?: string }) =>
    api.patch<UserRecord>(`/users/${id}`, body, { companyId }),
  setUserStatus: (companyId: string, id: string, status: ActiveStatus) =>
    api.patch<UserRecord>(`/users/${id}/status`, { status }, { companyId }),
  setMembershipStatus: (companyId: string, membershipId: string, status: ActiveStatus) =>
    api.patch<MemberRecord>(`/companies/${companyId}/members/${membershipId}`, { status }, { companyId }),
  branchRoles: (companyId: string, userId: string) =>
    api.get<BranchRoleAssignment[]>(`/users/${userId}/branch-roles`, { companyId }),
  assignBranchRole: (companyId: string, branchId: string, userId: string, roleId: string) =>
    api.post<{ id: string }>(`/users/${userId}/branch-roles`, { branch_id: branchId, role_id: roleId }, { companyId, branchId }),
  removeBranchRole: (companyId: string, branchId: string, userId: string, assignmentId: string) =>
    api.delete<null>(`/users/${userId}/branch-roles/${assignmentId}`, { companyId, branchId }),

  // ── Roles (company) ────────────────────────────────────────────────────────
  roles: (companyId: string) => api.get<RoleRecord[]>('/roles', { companyId }),
  permissionCatalogue: (companyId: string) => api.get<PermissionEntry[]>('/roles/permissions', { companyId }),
  createRole: (companyId: string, body: { name: string; description?: string }) =>
    api.post<RoleRecord>('/roles', body, { companyId }),
  updateRole: (companyId: string, id: string, body: { name?: string; description?: string }) =>
    api.patch<RoleRecord>(`/roles/${id}`, body, { companyId }),
  setRolePermissions: (companyId: string, id: string, permissions: string[]) =>
    api.put<RoleRecord>(`/roles/${id}/permissions`, { permissions }, { companyId }),
};

/** A person's display name, falling back to their email. */
export function personName(u: { first_name: string | null; last_name: string | null; email: string }): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email;
}

export const DEVICE_KIND_LABEL: Record<DisplayDeviceKind, string> = {
  QUEUE_CUSTOMER: 'Queue — customer screen',
  QUEUE_ADMIN: 'Queue — host screen',
  BANQUET_CHEF: 'Banquet — kitchen screen',
};

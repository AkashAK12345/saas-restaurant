import { api } from '@/lib/api/client';

/**
 * Settings calls: the company audit log, branch statutory settings and the
 * caller's own signed-in devices. Company-scoped calls send only X-Company-ID;
 * the device list is the caller's own and sends no context at all.
 */

export type AuditEventType = 'CREATE' | 'UPDATE' | 'DELETE' | 'SECURITY';

export interface AuditEntry {
  id: string;
  created_at: string;
  event_type: AuditEventType;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown> | null;
  user: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
  branch: { id: string; name: string } | null;
}

export interface AuditQuery {
  event_type?: AuditEventType;
  entity_type?: string;
  branch_id?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface BranchRecord {
  id: string;
  company_id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  gstin: string | null;
  fssai_license: string | null;
  banquet_gst_rate_bps: number;
}

export interface SessionEntry {
  handle: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const settingsApi = {
  auditLogs: (companyId: string, query: AuditQuery) =>
    api.get<{ data: AuditEntry[]; meta: { total: number; limit: number; offset: number } }>(
      `/audit-logs${qs({ ...query })}`,
      { companyId },
    ),

  branches: (companyId: string) => api.get<BranchRecord[]>('/branches', { companyId }),

  updateBranch: (
    companyId: string,
    branchId: string,
    body: Partial<{ gstin: string | null; fssai_license: string | null; banquet_gst_rate_bps: number }>,
  ) => api.patch<BranchRecord>(`/branches/${branchId}`, body, { companyId }),

  sessions: () => api.get<{ data: SessionEntry[] }>('/auth/sessions'),

  revokeSession: (handle: string) =>
    api.delete<{ revoked: true; current: boolean }>(`/auth/sessions/${encodeURIComponent(handle)}`),
};

/** A short, human label for a User-Agent string. Presentation only. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 60);
}

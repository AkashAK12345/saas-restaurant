import { api, apiDownload, type DownloadedFile } from '@/lib/api/client';
import type {
  DashboardResponse,
  ExportFormat,
  ReportCatalogue,
  ReportDefinition,
  ReportResponse,
} from './types';

/**
 * Reporting calls, through the shared typed client.
 *
 * Everything here is branch-scoped and sends both context headers. As
 * everywhere else, those headers REQUEST a context; the API proves membership,
 * branch access and permission before answering.
 */
export interface ReportContext {
  companyId: string;
  branchId: string;
}

const branch = (ctx: ReportContext) => ({ companyId: ctx.companyId, branchId: ctx.branchId });

export interface ReportQuery {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** Report-declared filters. The API rejects anything a report did not ask for. */
  options?: Record<string, string | undefined>;
}

function qs(query: ReportQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  };
  put('from', query.from);
  put('to', query.to);
  put('limit', query.limit);
  put('offset', query.offset);
  for (const [k, v] of Object.entries(query.options ?? {})) put(k, v);
  for (const [k, v] of Object.entries(extra)) put(k, v);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const reportsApi = {
  /** Only the reports this caller may actually run. */
  list: (ctx: ReportContext) => api.get<ReportCatalogue>('/reports', branch(ctx)),

  describe: (ctx: ReportContext, key: string) =>
    api.get<ReportDefinition>(`/reports/${encodeURIComponent(key)}`, branch(ctx)),

  run: (ctx: ReportContext, key: string, query: ReportQuery = {}) =>
    api.get<ReportResponse>(`/reports/${encodeURIComponent(key)}/data${qs(query)}`, branch(ctx)),

  /** The server names the file; we only save what it sends. */
  export: (
    ctx: ReportContext,
    key: string,
    format: ExportFormat,
    query: ReportQuery = {},
  ): Promise<DownloadedFile> =>
    apiDownload(
      `/reports/${encodeURIComponent(key)}/export${qs(query, { format })}`,
      `${key}.${format}`,
      branch(ctx),
    ),

  dashboard: (ctx: ReportContext, from?: string, to?: string) =>
    api.get<DashboardResponse>(`/dashboard${qs({ from, to })}`, branch(ctx)),
};

/**
 * Hand a downloaded file to the browser.
 *
 * Kept beside the call that produced it so no page has to remember to revoke
 * the object URL — a leaked blob URL pins the whole file in memory for the
 * life of the tab.
 */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

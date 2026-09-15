import { api } from '@/lib/api/client';
import type { StreamTicketResponse } from '@/lib/api/types';
import type {
  Customer,
  Paginated,
  QueueBoard,
  QueueTableAvailability,
  QueueToken,
  QueueTokenContact,
  QueueTokenDetail,
  QueueTokenStatus,
  RestaurantTable,
} from './types';

/**
 * Staff-side queue calls. Every one goes through the shared typed client, so
 * the Authorization header, the X-Company-ID / X-Branch-ID context headers and
 * the refresh-on-401 dance are handled in exactly one place.
 *
 * The context is passed explicitly rather than read from a provider so these
 * stay usable from tests and from any component tree.
 */
export interface QueueContext {
  companyId: string;
  branchId: string;
}

const ctxOpts = (ctx: QueueContext) => ({ companyId: ctx.companyId, branchId: ctx.branchId });

export const queueApi = {
  board: (ctx: QueueContext, serviceDate?: string) =>
    api.get<QueueBoard>(
      `/queue-tokens/board${serviceDate ? `?service_date=${encodeURIComponent(serviceDate)}` : ''}`,
      ctxOpts(ctx),
    ),

  list: (
    ctx: QueueContext,
    params: { status?: QueueTokenStatus; service_date?: string; limit?: number; offset?: number } = {},
  ) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v));
    }
    const suffix = q.toString();
    return api.get<Paginated<QueueToken>>(
      `/queue-tokens${suffix ? `?${suffix}` : ''}`,
      ctxOpts(ctx),
    );
  },

  get: (ctx: QueueContext, id: string) =>
    api.get<QueueTokenDetail>(`/queue-tokens/${id}`, ctxOpts(ctx)),

  /**
   * The party is sent SPLIT. The total is derived server-side, so there is no
   * `party_size` to send and no way for the two to disagree.
   */
  register: (
    ctx: QueueContext,
    body: {
      adults: number;
      kids?: number;
      /** ISO instant, for a table requested later rather than joining now. */
      advance_booking_at?: string;
      customer_id?: string;
    },
  ) => api.post<QueueToken>('/queue-tokens', body, ctxOpts(ctx)),

  call: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/call`, undefined, ctxOpts(ctx)),

  seat: (ctx: QueueContext, id: string, tableId?: string) =>
    api.post<QueueToken>(
      `/queue-tokens/${id}/seat`,
      tableId ? { table_id: tableId } : {},
      ctxOpts(ctx),
    ),

  noShow: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/no-show`, undefined, ctxOpts(ctx)),

  cancel: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/cancel`, undefined, ctxOpts(ctx)),

  assignTable: (ctx: QueueContext, id: string, tableId: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/assign-table`, { table_id: tableId }, ctxOpts(ctx)),

  releaseTable: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/release-table`, undefined, ctxOpts(ctx)),

  /** CALLED → WAITING: the party did not respond. */
  skip: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/skip`, undefined, ctxOpts(ctx)),

  /** SCHEDULED → WAITING: a booked party arrived. */
  checkIn: (ctx: QueueContext, id: string) =>
    api.post<QueueToken>(`/queue-tokens/${id}/check-in`, undefined, ctxOpts(ctx)),

  /**
   * A party's phone, for a call or a WhatsApp message. Fetched only when the
   * operator asks, and every read is audited server-side.
   */
  contact: (ctx: QueueContext, id: string) =>
    api.get<QueueTokenContact>(`/queue-tokens/${id}/contact`, ctxOpts(ctx)),

  /** Every table and which seated party holds it, on any service date. */
  tableAvailability: (ctx: QueueContext) =>
    api.get<QueueTableAvailability[]>('/queue-tokens/table-availability', ctxOpts(ctx)),

  /** Customers of the company, for the register screen's lookup. */
  customers: (ctx: QueueContext, limit = 100) =>
    api.get<Paginated<Customer>>(`/customers?limit=${limit}`, { companyId: ctx.companyId }),

  createCustomer: (ctx: QueueContext, body: { name: string; phone?: string }) =>
    api.post<Customer>('/customers', body, { companyId: ctx.companyId }),

  tables: (ctx: QueueContext, limit = 100) =>
    api.get<Paginated<RestaurantTable>>(`/tables?limit=${limit}`, ctxOpts(ctx)),

  /**
   * A single-use, 60-second ticket for the queue stream. Minted only after the
   * server re-checks queue.view at this branch; it is the ONLY credential that
   * may appear in the EventSource URL.
   */
  streamTicket: (ctx: QueueContext) =>
    api.post<StreamTicketResponse>('/realtime/tickets/queue', undefined, ctxOpts(ctx)),
};

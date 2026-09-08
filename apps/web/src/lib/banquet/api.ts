import { api } from '@/lib/api/client';
import type { StreamTicketResponse } from '@/lib/api/types';
import type { Paginated, Customer } from '@/lib/queue/types';
import type {
  BanquetBooking,
  BanquetBookingDetail,
  BanquetBookingItem,
  BanquetBookingStatus,
  BanquetEventPlan,
  BanquetHall,
  BanquetPackage,
  BanquetPayment,
  StaffKdsBoard,
} from './types';

/**
 * Staff-side banquet calls, through the shared typed client so the
 * Authorization header, the context headers and refresh-on-401 stay in one
 * place. Halls, bookings and the kitchen board are branch-scoped; packages are
 * company-scoped, so they deliberately send only X-Company-ID.
 */
export interface BanquetContext {
  companyId: string;
  branchId: string;
}

const branch = (ctx: BanquetContext) => ({ companyId: ctx.companyId, branchId: ctx.branchId });
const company = (ctx: BanquetContext) => ({ companyId: ctx.companyId });

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const banquetApi = {
  // Halls
  listHalls: (ctx: BanquetContext, limit = 100) =>
    api.get<Paginated<BanquetHall>>(`/banquet/halls${qs({ limit })}`, branch(ctx)),
  createHall: (ctx: BanquetContext, body: { name: string; capacity: number }) =>
    api.post<BanquetHall>('/banquet/halls', body, branch(ctx)),
  updateHall: (
    ctx: BanquetContext,
    id: string,
    body: { name?: string; capacity?: number; status?: BanquetHall['status'] },
  ) => api.patch<BanquetHall>(`/banquet/halls/${id}`, body, branch(ctx)),

  // Packages (company-scoped)
  listPackages: (ctx: BanquetContext, limit = 100) =>
    api.get<Paginated<BanquetPackage>>(`/banquet/packages${qs({ limit })}`, company(ctx)),
  createPackage: (
    ctx: BanquetContext,
    body: {
      name: string;
      description?: string;
      price_per_guest_minor: number;
      currency: string;
      items?: Array<{ name: string }>;
    },
  ) => api.post<BanquetPackage>('/banquet/packages', body, company(ctx)),
  updatePackage: (
    ctx: BanquetContext,
    id: string,
    body: Partial<{
      name: string;
      description: string | null;
      price_per_guest_minor: number;
      currency: string;
      status: BanquetPackage['status'];
      items: Array<{ name: string }>;
    }>,
  ) => api.patch<BanquetPackage>(`/banquet/packages/${id}`, body, company(ctx)),

  // Bookings
  listBookings: (
    ctx: BanquetContext,
    params: { status?: BanquetBookingStatus; from?: string; to?: string; hall_id?: string; limit?: number; offset?: number } = {},
  ) => api.get<Paginated<BanquetBooking>>(`/banquet/bookings${qs(params)}`, branch(ctx)),
  getBooking: (ctx: BanquetContext, id: string) =>
    api.get<BanquetBookingDetail>(`/banquet/bookings/${id}`, branch(ctx)),
  createBooking: (
    ctx: BanquetContext,
    body: {
      customer_id: string;
      hall_id: string;
      package_id: string;
      starts_at: string;
      ends_at: string;
      guest_count: number;
      notes?: string;
    },
  ) => api.post<BanquetBookingDetail>('/banquet/bookings', body, branch(ctx)),
  updateBooking: (
    ctx: BanquetContext,
    id: string,
    body: Partial<{ hall_id: string; starts_at: string; ends_at: string; guest_count: number; notes: string | null }>,
  ) => api.patch<BanquetBookingDetail>(`/banquet/bookings/${id}`, body, branch(ctx)),

  confirmBooking: (ctx: BanquetContext, id: string) =>
    api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/confirm`, undefined, branch(ctx)),
  completeBooking: (ctx: BanquetContext, id: string) =>
    api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/complete`, undefined, branch(ctx)),
  cancelBooking: (ctx: BanquetContext, id: string) =>
    api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/cancel`, undefined, branch(ctx)),

  // Advance & balance
  listPayments: (ctx: BanquetContext, id: string) =>
    api.get<BanquetPayment[]>(`/banquet/bookings/${id}/payments`, branch(ctx)),
  createPayment: (
    ctx: BanquetContext,
    id: string,
    body: { amount_minor: number; currency: string; method?: string; reference?: string },
  ) =>
    api.post<{ payment: BanquetPayment; balance: BanquetBookingDetail['balance'] }>(
      `/banquet/bookings/${id}/payments`,
      body,
      branch(ctx),
    ),

  // Event plan
  getEventPlan: (ctx: BanquetContext, id: string) =>
    api.get<BanquetEventPlan | null>(`/banquet/bookings/${id}/event-plan`, branch(ctx)),
  saveEventPlan: (
    ctx: BanquetContext,
    id: string,
    body: { service_at?: string | null; setup_notes?: string | null; kitchen_notes?: string | null },
  ) => api.put<BanquetEventPlan>(`/banquet/bookings/${id}/event-plan`, body, branch(ctx)),

  // Kitchen
  kdsBoard: (ctx: BanquetContext, serviceDate?: string) =>
    api.get<StaffKdsBoard>(`/banquet/kds/board${qs({ service_date: serviceDate })}`, branch(ctx)),
  startItem: (ctx: BanquetContext, itemId: string) =>
    api.post<BanquetBookingItem>(`/banquet/kds/items/${itemId}/start`, undefined, branch(ctx)),
  readyItem: (ctx: BanquetContext, itemId: string) =>
    api.post<BanquetBookingItem>(`/banquet/kds/items/${itemId}/ready`, undefined, branch(ctx)),

  /** Single-use, 60-second ticket for the banquet-kds stream. */
  streamTicket: (ctx: BanquetContext) =>
    api.post<StreamTicketResponse>('/realtime/tickets/banquet-kds', undefined, branch(ctx)),

  /** Customers for the booking form — company-scoped, like the queue register. */
  customers: (ctx: BanquetContext, limit = 100) =>
    api.get<Paginated<Customer>>(`/customers${qs({ limit })}`, company(ctx)),
};

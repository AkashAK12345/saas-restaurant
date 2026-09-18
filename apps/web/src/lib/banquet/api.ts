import { api } from '@/lib/api/client';
import type { StreamTicketResponse } from '@/lib/api/types';
import type { Paginated, Customer } from '@/lib/queue/types';
import type {
  Availability,
  BanquetAdjustmentKind,
  BanquetBill,
  BanquetBooking,
  BanquetBookingDetail,
  BanquetBookingItem,
  BanquetBookingPhoto,
  BanquetBookingStatus,
  BanquetEventPlan,
  BanquetFinance,
  BanquetHall,
  BanquetHallSlot,
  BanquetPackage,
  BanquetPayment,
  ChefCalendar,
  ChefCalendarBooking,
  PlateRequest,
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

export type BookingTab = 'drafts' | 'upcoming' | 'past' | 'cancelled' | 'all';
export type PaymentFilter = 'pending' | 'paid' | 'unverified';
export type DateField = 'event' | 'advance' | 'final';

export interface ListBookingsParams {
  status?: BanquetBookingStatus;
  tab?: BookingTab;
  payment?: PaymentFilter;
  date_field?: DateField;
  from?: string;
  to?: string;
  hall_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

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
  createSlot: (
    ctx: BanquetContext,
    hallId: string,
    body: { name: string; start_time: string; end_time: string; position?: number },
  ) => api.post<BanquetHallSlot>(`/banquet/halls/${hallId}/slots`, body, branch(ctx)),
  updateSlot: (
    ctx: BanquetContext,
    hallId: string,
    slotId: string,
    body: Partial<{ name: string; start_time: string; end_time: string; position: number; status: BanquetHallSlot['status'] }>,
  ) => api.patch<BanquetHallSlot>(`/banquet/halls/${hallId}/slots/${slotId}`, body, branch(ctx)),
  availability: (ctx: BanquetContext, params: { from: string; to: string; hall_id?: string }) =>
    api.get<Availability>(`/banquet/availability${qs(params)}`, branch(ctx)),
  finance: (ctx: BanquetContext, params: { from: string; to: string; payment?: string }) =>
    api.get<BanquetFinance>(`/banquet/finance${qs(params)}`, branch(ctx)),

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
  listBookings: (ctx: BanquetContext, params: ListBookingsParams = {}) =>
    api.get<Paginated<BanquetBooking>>(`/banquet/bookings${qs({ ...params })}`, branch(ctx)),
  getBooking: (ctx: BanquetContext, id: string) =>
    api.get<BanquetBookingDetail>(`/banquet/bookings/${id}`, branch(ctx)),
  getBill: (ctx: BanquetContext, id: string) =>
    api.get<BanquetBill>(`/banquet/bookings/${id}/bill`, branch(ctx)),
  createBooking: (
    ctx: BanquetContext,
    body: {
      customer_id: string;
      hall_id: string;
      package_id?: string;
      starts_at: string;
      ends_at: string;
      guest_count: number;
      extra_pax?: number;
      apply_gst?: boolean;
      notes?: string;
      initial_payment?: { amount_minor: number; method?: string; reference?: string };
    },
  ) => api.post<BanquetBookingDetail>('/banquet/bookings', body, branch(ctx)),
  updateBooking: (
    ctx: BanquetContext,
    id: string,
    body: Partial<{
      hall_id: string;
      starts_at: string;
      ends_at: string;
      guest_count: number;
      extra_pax: number;
      apply_gst: boolean;
      package_id: string | null;
      notes: string | null;
    }>,
  ) => api.patch<BanquetBookingDetail>(`/banquet/bookings/${id}`, body, branch(ctx)),

  confirmBooking: (ctx: BanquetContext, id: string) =>
    api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/confirm`, undefined, branch(ctx)),
  completeBooking: (ctx: BanquetContext, id: string) =>
    api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/complete`, undefined, branch(ctx)),
  deleteBooking: (ctx: BanquetContext, id: string) =>
    api.delete<void>(`/banquet/bookings/${id}`, branch(ctx)),
  cancelBooking: (ctx: BanquetContext, id: string, reason?: string) =>
    api.post<BanquetBookingDetail>(
      `/banquet/bookings/${id}/cancel`,
      reason ? { reason } : undefined,
      branch(ctx),
    ),

  // Pricing lines
  addAdjustment: (
    ctx: BanquetContext,
    id: string,
    body: { kind: BanquetAdjustmentKind; description: string; amount_minor: number },
  ) => api.post<BanquetBookingDetail>(`/banquet/bookings/${id}/adjustments`, body, branch(ctx)),
  reverseAdjustment: (ctx: BanquetContext, id: string, adjustmentId: string) =>
    api.post<BanquetBookingDetail>(
      `/banquet/bookings/${id}/adjustments/${adjustmentId}/reverse`,
      undefined,
      branch(ctx),
    ),

  // Payments
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
  /** Corrects an unverified payment: reverses it and records a fresh one — never an in-place edit. */
  updatePayment: (
    ctx: BanquetContext,
    bookingId: string,
    paymentId: string,
    body: { amount_minor: number; method?: string; reference?: string },
  ) =>
    api.patch<{ payment: BanquetPayment; balance: BanquetBookingDetail['balance'] }>(
      `/banquet/bookings/${bookingId}/payments/${paymentId}`,
      body,
      branch(ctx),
    ),
  verifyPayment: (ctx: BanquetContext, paymentId: string, note?: string) =>
    api.post<BanquetPayment>(
      `/banquet/payments/${paymentId}/verify`,
      note ? { note } : {},
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
  chefCalendar: (ctx: BanquetContext, params: { from: string; to: string }) =>
    api.get<ChefCalendar>(`/banquet/kds/calendar${qs(params)}`, branch(ctx)),
  chefEvent: (ctx: BanquetContext, id: string) =>
    api.get<ChefCalendarBooking>(`/banquet/kds/events/${id}`, branch(ctx)),
  startItem: (ctx: BanquetContext, itemId: string) =>
    api.post<BanquetBookingItem>(`/banquet/kds/items/${itemId}/start`, undefined, branch(ctx)),
  readyItem: (ctx: BanquetContext, itemId: string) =>
    api.post<BanquetBookingItem>(`/banquet/kds/items/${itemId}/ready`, undefined, branch(ctx)),

  // Plate approval
  bookingPlateRequests: (ctx: BanquetContext, bookingId: string) =>
    api.get<PlateRequest[]>(`/banquet/bookings/${bookingId}/plate-requests`, branch(ctx)),
  requestPlates: (ctx: BanquetContext, bookingId: string, body: { item_id: string; plates: number; note?: string }) =>
    api.post<PlateRequest>(`/banquet/bookings/${bookingId}/plate-requests`, body, branch(ctx)),
  kitchenPlateRequests: (ctx: BanquetContext, serviceDate?: string) =>
    api.get<{ service_date: string; requests: PlateRequest[] }>(
      `/banquet/kds/plate-requests${qs({ service_date: serviceDate })}`,
      branch(ctx),
    ),
  approvePlates: (ctx: BanquetContext, id: string) =>
    api.post<PlateRequest>(`/banquet/kds/plate-requests/${id}/approve`, undefined, branch(ctx)),
  rejectPlates: (ctx: BanquetContext, id: string, reason: string) =>
    api.post<PlateRequest>(`/banquet/kds/plate-requests/${id}/reject`, { reason }, branch(ctx)),
  dispatchPlates: (ctx: BanquetContext, id: string) =>
    api.post<PlateRequest>(`/banquet/kds/plate-requests/${id}/dispatch`, undefined, branch(ctx)),

  // Booking photos
  listPhotos: (ctx: BanquetContext, bookingId: string) =>
    api.get<BanquetBookingPhoto[]>(`/banquet/bookings/${bookingId}/photos`, branch(ctx)),
  uploadPhoto: (ctx: BanquetContext, bookingId: string, body: { data: string; mime_type: string; file_name?: string }) =>
    api.post<BanquetBookingPhoto>(`/banquet/bookings/${bookingId}/photos`, body, branch(ctx)),
  deletePhoto: (ctx: BanquetContext, bookingId: string, photoId: string) =>
    api.delete(`/banquet/bookings/${bookingId}/photos/${photoId}`, branch(ctx)),
  photoUrl: (ctx: BanquetContext, bookingId: string, photoId: string) =>
    `/api/banquet/bookings/${bookingId}/photos/${photoId}`,

  /** Single-use, 60-second ticket for the banquet-kds stream. */
  streamTicket: (ctx: BanquetContext) =>
    api.post<StreamTicketResponse>('/realtime/tickets/banquet-kds', undefined, branch(ctx)),

  /** Customers for the booking form — company-scoped, like the queue register. */
  customers: (ctx: BanquetContext, limit = 100) =>
    api.get<Paginated<Customer>>(`/customers${qs({ limit })}`, company(ctx)),
  createCustomer: (ctx: BanquetContext, body: { name: string; phone?: string }) =>
    api.post<Customer>('/customers', body, company(ctx)),
  getCustomer: (ctx: BanquetContext, id: string) => api.get<Customer>(`/customers/${id}`, company(ctx)),
  updateCustomer: (ctx: BanquetContext, id: string, body: { name?: string; phone?: string | null }) =>
    api.patch<Customer>(`/customers/${id}`, body, company(ctx)),
};

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BanquetBookingStatus } from '@samco/database';
import { BanquetKdsService } from './banquet-kds.service.js';
import { BanquetBookingsService } from './banquet-bookings.service.js';
import type { PrismaService } from '../../core/database/prisma.service.js';
import type { AuditLogService } from '../audit-logs/audit-logs.service.js';
import type { EventBroker } from '../../common/realtime/event-broker.js';
import type { AuthorizationService } from '../../common/authorization/authorization.service.js';

const BRANCH = '22222222-2222-4222-8222-222222222222';
const HALL = '66666666-6666-4666-8666-666666666666';

function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    branch_id: BRANCH,
    hall_id: HALL,
    hall: { id: HALL, name: 'Crown Hall', capacity: 200 },
    hall_name: 'Crown Hall',
    customer: { id: 'c-1', name: 'John' },
    // 12:00 in Kolkata on 20 Sep.
    starts_at: new Date('2026-09-20T06:30:00.000Z'),
    ends_at: new Date('2026-09-20T09:30:00.000Z'),
    guest_count: 90,
    extra_pax: 10,
    status: BanquetBookingStatus.CONFIRMED,
    package_name: 'Silver',
    items: [{ id: 'i1', name: 'Paneer tikka', position: 0, kds_status: 'PENDING', started_at: null, ready_at: null }],
    event_plan: { service_at: null, kitchen_notes: 'No nuts', setup_notes: 'Round tables' },
    payments: [],
    adjustments: [],
    ...over,
  };
}

describe('BanquetKdsService — chef calendar', () => {
  let prisma: any;
  let service: BanquetKdsService;

  beforeEach(() => {
    prisma = {
      branch: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
      banquetBooking: { findMany: vi.fn().mockResolvedValue([booking()]) },
      banquetHallSlot: {
        findMany: vi.fn().mockResolvedValue([
          { hall_id: HALL, name: 'Lunch', start_time: '11:00', end_time: '16:00' },
          { hall_id: HALL, name: 'Dinner', start_time: '18:00', end_time: '23:00' },
        ]),
      },
    };
    const bookings = new BanquetBookingsService(
      prisma as unknown as PrismaService,
      {} as AuditLogService,
      { publish: vi.fn() } as unknown as EventBroker,
      {} as AuthorizationService,
    );
    service = new BanquetKdsService(
      prisma as unknown as PrismaService,
      {} as AuditLogService,
      bookings,
      { publish: vi.fn() } as unknown as EventBroker,
    );
  });

  it('reads the range in branch-local days and shows only what the kitchen cooks', async () => {
    await service.chefCalendar(BRANCH, '2026-09-18', '2026-09-24');
    const { where } = prisma.banquetBooking.findMany.mock.calls[0][0];
    expect(where.status).toEqual({ in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] });
    expect(where.starts_at).toEqual({
      gte: new Date('2026-09-17T18:30:00.000Z'),
      lt: new Date('2026-09-24T18:30:00.000Z'),
    });
  });

  it('gives each event its day, plates, hall, slot and menu', async () => {
    const view = await service.chefCalendar(BRANCH, '2026-09-18', '2026-09-24', true);
    expect(view.timezone).toBe('Asia/Kolkata');
    expect(view.bookings[0]).toMatchObject({
      date: '2026-09-20',
      customer_name: 'John',
      guest_count: 100,
      hall_name: 'Crown Hall',
      // Starts at 12:00, inside the 11:00–16:00 Lunch slot.
      slot_name: 'Lunch',
      package_name: 'Silver',
      kitchen_notes: 'No nuts',
      setup_notes: 'Round tables',
    });
    expect(view.bookings[0].items.map((i) => i.name)).toEqual(['Paneer tikka']);
  });

  it('hides who the event is for from a kitchen-only caller', async () => {
    const view = await service.chefCalendar(BRANCH, '2026-09-18', '2026-09-24', false);
    expect(view.bookings[0].customer_name).toBeNull();
  });

  it('leaves the slot empty when the event fits no slot of its hall', async () => {
    prisma.banquetBooking.findMany.mockResolvedValue([
      booking({ starts_at: new Date('2026-09-20T11:30:00.000Z') }), // 17:00 local
    ]);
    const view = await service.chefCalendar(BRANCH, '2026-09-18', '2026-09-24');
    expect(view.bookings[0].slot_name).toBeNull();
  });

  it('returns one event in the calendar\'s shape, scoped to the branch and to what the kitchen cooks', async () => {
    prisma.banquetBooking.findFirst = vi.fn().mockResolvedValue(booking());
    const view = await service.chefEvent(BRANCH, 'bk-1', true);
    expect(prisma.banquetBooking.findFirst.mock.calls[0][0].where).toEqual({
      id: 'bk-1',
      branch_id: BRANCH,
      status: { in: [BanquetBookingStatus.CONFIRMED, BanquetBookingStatus.COMPLETED] },
    });
    expect(view).toMatchObject({ date: '2026-09-20', customer_name: 'John', slot_name: 'Lunch', package_name: 'Silver' });
  });

  it('404s an event that is not the kitchen\'s to see', async () => {
    prisma.banquetBooking.findFirst = vi.fn().mockResolvedValue(null);
    await expect(service.chefEvent(BRANCH, 'bk-draft')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['2026-09-31', '2026-10-01', /real calendar dates/],
    ['2026-09-24', '2026-09-18', /not be before/],
    ['2026-09-01', '2026-10-31', /at most 42 days/],
  ])('refuses the range %s..%s', async (from, to, message) => {
    await expect(service.chefCalendar(BRANCH, from, to)).rejects.toThrow(message);
    await expect(service.chefCalendar(BRANCH, from, to)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.banquetBooking.findMany).not.toHaveBeenCalled();
  });
});

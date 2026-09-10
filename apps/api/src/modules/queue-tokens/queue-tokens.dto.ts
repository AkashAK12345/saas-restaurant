import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { QueueTokenStatus } from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { SERVICE_DATE_PATTERN } from './queue-service-date.js';

/**
 * The largest party the queue will take. A restaurant seating more than this
 * at one table is running a banquet, which has its own module and its own
 * booking rules.
 */
export const MAX_PARTY_SIZE = 100;

/**
 * How far ahead an advance booking may be placed. A queue token is a
 * same-service artefact — its number restarts daily — so a request weeks out
 * belongs in Banquet, not here.
 */
export const MAX_ADVANCE_BOOKING_HOURS = 24;

/**
 * Registration. The branch (and therefore the company, the timezone and the
 * service date) comes from the guard-verified X-Branch-ID context, never from
 * the body. The token number is allocated server-side.
 *
 * `customer_id` is optional: anonymous walk-ins register without one. When
 * given it must be an ACTIVE customer of the caller's company; no customer
 * record is ever created implicitly here — use POST /customers for that.
 */
export class RegisterQueueTokenDto {
  /**
   * The party, split. `party_size` is NOT accepted from a client: it is the
   * sum, computed server-side, so the total and the split can never be sent
   * disagreeing with each other.
   */
  @IsInt()
  @Min(1)
  @Max(MAX_PARTY_SIZE)
  adults!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PARTY_SIZE)
  kids?: number;

  /**
   * A future instant, when the guest asked for a table later rather than
   * joining the live queue. ISO 8601 with an offset — an instant, not a wall
   * clock, so it cannot be ambiguous about which branch's day it belongs to.
   */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'advance_booking_at must be an ISO 8601 instant' })
  advance_booking_at?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;
}

/** Seating may assign a table in the same operation. */
export class SeatQueueTokenDto {
  @IsOptional()
  @IsUUID()
  table_id?: string;
}

export class AssignQueueTableDto {
  @IsUUID()
  table_id!: string;
}

/**
 * List filters. `service_date` defaults to today's service date in the
 * branch's timezone — a queue list is inherently a per-day view. The pattern
 * check catches shape; the service rejects impossible calendar dates.
 */
export class ListQueueTokensQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(SERVICE_DATE_PATTERN, { message: 'service_date must be YYYY-MM-DD' })
  service_date?: string;

  @IsOptional()
  @IsEnum(QueueTokenStatus)
  status?: QueueTokenStatus;
}

/** Boards are whole-day views, so they take a date but no pagination. */
export class QueueBoardQueryDto {
  @IsOptional()
  @Matches(SERVICE_DATE_PATTERN, { message: 'service_date must be YYYY-MM-DD' })
  service_date?: string;
}

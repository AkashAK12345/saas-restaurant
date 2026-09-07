import {
  IsEnum,
  IsInt,
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
 * Registration. The branch (and therefore the company, the timezone and the
 * service date) comes from the guard-verified X-Branch-ID context, never from
 * the body. The token number is allocated server-side.
 *
 * `customer_id` is optional: anonymous walk-ins register without one. When
 * given it must be an ACTIVE customer of the caller's company; no customer
 * record is ever created implicitly here — use POST /customers for that.
 */
export class RegisterQueueTokenDto {
  @IsInt()
  @Min(1)
  @Max(100)
  party_size!: number;

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

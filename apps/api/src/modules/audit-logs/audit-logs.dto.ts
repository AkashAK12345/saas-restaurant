import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsDate,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AuditEventType } from '@samco/database';

/**
 * Query filters for GET /audit-logs.
 *
 * Field names here ARE the public API contract and must match the keys read by
 * AuditLogService.listLogs exactly. They previously did not (snake_case here,
 * camelCase in the service), so every filter was silently ignored while the
 * global forbidNonWhitelisted pipe rejected the camelCase names a client would
 * have had to send instead — the feature was unreachable in both directions.
 *
 * company_id is deliberately absent: company scope comes from the authorized
 * X-Company-ID context, never from a query parameter.
 */
export class AuditLogFilterDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsEnum(AuditEventType)
  event_type?: AuditEventType;

  @IsOptional()
  @IsString()
  entity_type?: string;

  @IsOptional()
  @IsString()
  entity_id?: string;

  /** Inclusive lower bound on created_at (ISO 8601). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Inclusive upper bound on created_at (ISO 8601). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  offset: number = 0;
}

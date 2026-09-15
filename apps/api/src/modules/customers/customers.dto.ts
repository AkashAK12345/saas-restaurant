import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CustomerStatus } from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

/**
 * List filters. `q` matches a name (case-insensitive substring) or, when it
 * carries digits, a phone number containing those digits. Always within the
 * guard-verified company.
 */
export class ListCustomersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

/**
 * Customer is company-scoped; the company comes from the guard-verified
 * X-Company-ID context, never from the body.
 */
export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  // Optional: queue walk-ins may be anonymous. Normalized by the service.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  // Send null to clear a phone; omit to leave it unchanged.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

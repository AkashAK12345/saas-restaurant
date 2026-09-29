import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PAYMENT_MODES, type PaymentMode } from './purchase-order.dto.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** The supplier ledger for a cycle: dates, one branch or all, a search. */
export class SupplierLedgerQueryDto {
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from!: string;

  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to!: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  /** A supplier's name, label or phone. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** "Record payment" against one delivery's invoice. */
export class RecordPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Enter an amount paid' })
  @Max(2_000_000_000)
  amount_minor!: number;

  @IsIn(PAYMENT_MODES)
  payment_mode!: PaymentMode;
}

/** "Pay all": every invoice still due from a supplier, one branch or all. */
export class PayAllDto {
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsIn(PAYMENT_MODES)
  payment_mode!: PaymentMode;
}

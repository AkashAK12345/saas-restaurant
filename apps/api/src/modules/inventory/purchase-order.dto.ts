import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ORDER_TABS = ['all', 'sent', 'received'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const ORDER_SORTS = ['newest', 'oldest', 'received', 'supplier', 'amount'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export const PAYMENT_MODES = ['CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** A delivery may carry this many photos at most, each this large at most. */
export const MAX_ORDER_PHOTOS = 10;
export const MAX_ORDER_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The Purchase list: a tab (All, Sent, Received), and filters that narrow it.
 * Dates bound when an order was raised — or, on Received, when it arrived.
 */
export class PurchaseOrderListQueryDto {
  @IsOptional()
  @IsIn(ORDER_TABS)
  tab?: OrderTab;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  vendor_id?: string;

  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;

  /** Cancelled orders are left out unless asked for. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_cancelled?: boolean;

  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort?: OrderSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** A line as the Receive Order screen holds it. */
export class OrderLineDto {
  /** An existing line of the order; none for a line just added. */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** The raw material; may be left out for an existing line that has none. */
  @IsOptional()
  @IsUUID()
  item_id?: string;

  /** In the item's purchase unit. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'A quantity has at most 3 decimals' })
  @Min(0.001, { message: 'A quantity must be more than 0' })
  @Max(1_000_000)
  quantity!: number;

  /** Price per purchase unit, before GST, in minor units. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  rate_minor!: number;

  /** Ticked: it arrived in this delivery. Only read when receiving. */
  @IsOptional()
  @IsBoolean()
  receive?: boolean;
}

/**
 * "Save": the order's supplier and its lines still awaited. Without lines,
 * only the supplier changes (Edit Supplier's switch).
 */
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsUUID()
  vendor_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'An order needs at least one item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

/** "Receive": save, then take the ticked lines in as one delivery. */
export class ReceivePurchaseOrderDto extends UpdatePurchaseOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  paid_minor!: number;

  @IsIn(PAYMENT_MODES)
  payment_mode!: PaymentMode;
}

export class UploadOrderPhotoDto {
  @IsString()
  @IsNotEmpty()
  data!: string;

  @IsString()
  @Matches(/^image\/(jpeg|png|webp|gif)$/, { message: 'mime_type must be image/jpeg, image/png, image/webp or image/gif' })
  mime_type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;
}

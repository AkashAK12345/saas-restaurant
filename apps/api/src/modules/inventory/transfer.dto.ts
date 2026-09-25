import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** An optional text field left blank is simply not given. */
const trimOrNone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export const TRANSFER_LINE_KINDS = ['RAW', 'PRODUCT'] as const;
export type TransferLineKind = (typeof TRANSFER_LINE_KINDS)[number];

export class TransferLineDto {
  /** RAW: a raw material, whose stock moves. PRODUCT: a menu product, recorded only. */
  @IsIn(TRANSFER_LINE_KINDS)
  kind!: TransferLineKind;

  @IsUUID()
  id!: string;

  /** In the raw material's stock unit (or the product's own unit). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'A quantity has at most 3 decimals' })
  @Min(0.001, { message: 'A quantity must be more than 0' })
  @Max(1_000_000)
  quantity!: number;
}

/** "Transfer": what one outlet sends another, landing there at once. */
export class RecordTransferDto {
  @IsUUID()
  from_branch_id!: string;

  @IsUUID()
  to_branch_id!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @IsOptional()
  @Transform(trimOrNone)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class TransferStockQueryDto {
  /** The source outlet; without one, only the products (which carry no stock). */
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

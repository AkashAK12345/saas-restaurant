import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** An optional text field left blank is simply not given. */
const trimOrNone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;
const upperOrNone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') || undefined : value;

/** "Create supplier": a name and a number to reach them; the rest optional. */
export class CreateSupplierDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the supplier name' })
  @MaxLength(160)
  name!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9][0-9 -]{5,18}[0-9]$/, { message: 'Enter a contact number (digits, 7–20 long)' })
  phone!: string;

  @IsOptional()
  @Transform(upperOrNone)
  @Matches(/^[0-9]{2}[A-Z0-9]{13}$/, { message: 'A GST number is 15 characters, starting with the 2-digit state code' })
  gstin?: string;

  @IsOptional()
  @Transform(trimOrNone)
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Transform(trimOrNone)
  @IsString()
  @MaxLength(120)
  bank_account_name?: string;

  @IsOptional()
  @Transform(upperOrNone)
  @Matches(/^[0-9A-Z]{6,34}$/, { message: 'An account number is 6–34 letters or digits' })
  bank_account_number?: string;

  @IsOptional()
  @Transform(upperOrNone)
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'An IFSC is 11 characters, like SBIN0001234' })
  bank_ifsc?: string;

  @IsOptional()
  @Transform(trimOrNone)
  @IsString()
  @MaxLength(120)
  bank_name?: string;
}

export class PurchaseLineDto {
  @IsUUID()
  item_id!: string;

  /** In the item's purchase unit: 2 bags, 12.5 Kg. */
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
}

/** "Record purchase": what arrived at an outlet from a supplier. */
export class RecordPurchaseDto {
  @IsUUID()
  branch_id!: string;

  @IsUUID()
  vendor_id!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];

  @IsOptional()
  @Transform(trimOrNone)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SearchQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

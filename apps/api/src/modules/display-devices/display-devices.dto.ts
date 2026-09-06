import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DisplayDeviceKind } from '@samco/database';

/**
 * Pairing request. The branch is the guard-verified X-Branch-ID context, never
 * a body field.
 */
export class CreateDisplayDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(DisplayDeviceKind)
  kind!: DisplayDeviceKind;
}

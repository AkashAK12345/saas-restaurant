import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CompanyStatus, MembershipStatus } from '@samco/database';

// ── Company DTOs ──────────────────────────────────────────────────────────────

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;
}

// ── Membership DTOs ───────────────────────────────────────────────────────────

export class CreateMembershipDto {
  @IsUUID()
  @IsNotEmpty()
  user_id!: string;

  // Optional: membership starts ACTIVE by default.
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class UpdateMembershipDto {
  @IsEnum(MembershipStatus)
  status!: MembershipStatus;
}

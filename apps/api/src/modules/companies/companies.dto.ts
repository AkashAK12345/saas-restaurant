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

  // `status` is deliberately NOT accepted here.
  //
  // Company lifecycle transitions go through PATCH /companies/:id/status, which
  // carries a different permission (companies.disable) and a different
  // authorization scope. Allowing status on the general update route meant
  // `companies.update` could disable a company through a path that then required
  // the company to be ACTIVE to use — making the action unrecoverable.
}

/**
 * Company lifecycle transition payload.
 *
 * SUSPENDED is intentionally not accepted: suspension is a platform-imposed
 * state (billing, abuse, compliance) and a customer administrator must not be
 * able to set it or clear it. See CompaniesService.updateCompanyStatus.
 */
export class UpdateCompanyStatusDto {
  @IsEnum(CompanyStatus)
  status!: CompanyStatus;
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

import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '@samco/database';
import { PASSWORD_POLICY } from '../../common/password-policy.js';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  // Same policy object as the password-change flow, so account creation and
  // rotation can never drift apart.
  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_POLICY.MIN_LENGTH)
  @MaxLength(PASSWORD_POLICY.MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  // is_superadmin is NOT accepted from clients.
  // password_hash is NOT accepted from clients.
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  // Disallowed fields:
  // - email  (not updatable through this API)
  // - password (use a dedicated change-password flow)
  // - is_superadmin
  // - password_hash
}

/**
 * GLOBAL user lifecycle change — not a company membership change.
 *
 * Setting INACTIVE stops the account authenticating anywhere on the platform.
 * To remove someone from a single company, update their CompanyMembership
 * instead (PATCH /companies/:id/members/:membershipId).
 */
export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

export class AssignBranchRoleDto {
  @IsUUID()
  @IsNotEmpty()
  branch_id!: string;

  @IsUUID()
  @IsNotEmpty()
  role_id!: string;
}

export class ListUsersQueryDto {
  // Optional branch filter — narrows results to users with
  // any role at the given branch within the company.
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}

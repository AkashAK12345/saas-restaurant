import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
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

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  MaxLength,
} from 'class-validator';
import { PASSWORD_POLICY } from '../../common/password-policy.js';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

/**
 * Authenticated password change.
 *
 * There is deliberately NO user id field. The account being changed is always
 * the authenticated caller, taken from the verified JWT — accepting a target id
 * here would make authorization depend on client-supplied input. The global
 * ValidationPipe runs with `forbidNonWhitelisted`, so a client that tries to
 * smuggle `user_id` (or any other field) is rejected outright with a 400.
 *
 * `current_password` carries no length rules: it is validated by comparison
 * against the stored hash, and applying the policy to it would reject users
 * whose existing password predates the policy.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  current_password!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_POLICY.MIN_LENGTH)
  @MaxLength(PASSWORD_POLICY.MAX_LENGTH)
  new_password!: string;
}

/** POST /auth/password-recovery/request — the same reply for every email. */
export class PasswordRecoveryRequestDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

/** POST /auth/password-recovery/reset — the emailed code and the new password. */
export class PasswordRecoveryResetDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(PASSWORD_POLICY.MIN_LENGTH)
  @MaxLength(PASSWORD_POLICY.MAX_LENGTH)
  new_password!: string;
}

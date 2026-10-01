import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PASSWORD_POLICY } from '../../common/password-policy.js';
import { TASK_MODES, USER_TYPES, type RoutineLevel, type TaskMode, type UserTypeKey } from './user-access.js';

/** The toggles chosen on the form. Unknown keys are dropped, not refused. */
export class AccessSelectionDto {
  @IsArray()
  @IsString({ each: true })
  toggles!: string[];

  @IsObject()
  routines!: Record<string, RoutineLevel>;

  @IsIn(TASK_MODES)
  tasks!: TaskMode;
}

/** PUT /user-access/users/:id — who a member is and what they may do. */
export class SaveUserAccessDto {
  @IsIn(USER_TYPES)
  user_type!: UserTypeKey;

  /** Every branch of the company, now and to come. */
  @IsBoolean()
  corporate!: boolean;

  /** The one branch they work at, unless corporate. */
  @ValidateIf((o: SaveUserAccessDto) => !o.corporate)
  @IsUUID()
  branch_id?: string | null;

  @ValidateNested()
  @Type(() => AccessSelectionDto)
  access!: AccessSelectionDto;
}

/** POST /user-access/users — a new account, its membership and its access. */
export class CreateUserAccessDto extends SaveUserAccessDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.MIN_LENGTH)
  @MaxLength(PASSWORD_POLICY.MAX_LENGTH)
  password!: string;
}

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ChecklistItemKind,
  ChecklistTemplateStatus,
  RoutineFrequency,
  TaskPriority,
  TaskStatus,
} from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { TIME_OF_DAY_PATTERN } from './routine-schedule.js';

/**
 * A query-string flag. `@Type(() => Boolean)` would read the STRING "false" as
 * true (any non-empty string is truthy), so `?overdue=false` used to filter to
 * overdue tasks. Only the literal words are accepted; anything else is left
 * as-is for @IsBoolean to reject.
 */
export const queryBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * Scope always comes from the guard-verified context headers, never a body.
 * Nothing here accepts a task `status`: lifecycle changes are explicit
 * operations, so there is no shape in which a client can set one.
 */

// ── Checklist templates (company-scoped) ────────────────────────────────────

export class ChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  /** What the item asks for; a tick when omitted. */
  @IsOptional()
  @IsEnum(ChecklistItemKind)
  kind?: ChecklistItemKind;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  /** Group label ("Today's Summary", "EB", ...). Omitted renders flat. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  section?: string;
}

export class CreateChecklistTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  items!: ChecklistItemDto[];
}

export class UpdateChecklistTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(ChecklistTemplateStatus)
  status?: ChecklistTemplateStatus;

  /** When given, replaces the item list wholesale. Existing tasks keep their snapshots. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  items?: ChecklistItemDto[];
}

// ── Tasks (branch-scoped) ───────────────────────────────────────────────────

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  /** Absolute instant. An offset or Z is required so the meaning is unambiguous. */
  @IsOptional()
  @IsISO8601({ strict: true })
  due_at?: string;

  @IsOptional()
  @IsUUID()
  assignee_id?: string;

  /** Copies the template's items onto the task as its own checklist. */
  @IsOptional()
  @IsUUID()
  checklist_template_id?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601({ strict: true })
  due_at?: string | null;
}

/** Assignment is responsibility, never authorization. Null clears it. */
export class AssignTaskDto {
  @IsOptional()
  @IsUUID()
  assignee_id?: string | null;
}

export class AddTaskCommentDto {
  /** Trimmed before validation, so a comment of only spaces is empty and refused. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}

export class ToggleChecklistItemDto {
  @IsBoolean()
  is_done!: boolean;

  /**
   * The answer, for a NUMBER / TEXT / RATING / DATE item: required when
   * marking it done, ignored-as-null when clearing it, refused on a tick item.
   * Validated per kind in checklist-values.ts.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  value?: string;
}

export const MAX_ITEM_PHOTOS = 5;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

/** A photo attached to a PHOTO-kind checklist item. Same shape as banquet's UploadBookingPhotoDto. */
export class UploadChecklistItemPhotoDto {
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

/** A branch-local window for a routine's transposed log. */
export class RoutineLogQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to!: string;
}

/** The same window, rendered as a file. */
export class RoutineLogExportQueryDto extends RoutineLogQueryDto {
  @IsIn(['xlsx', 'pdf'], { message: 'format must be xlsx or pdf' })
  format!: 'xlsx' | 'pdf';
}

export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  /** A specific member of staff, or the literal "me" for the caller. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  /** Only tasks with no one responsible yet. */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  unassigned?: boolean;

  /** Only open tasks whose due time has passed. */
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsUUID()
  routine_id?: string;

  /** Inclusive bounds on due_at. */
  @IsOptional()
  @IsISO8601({ strict: true })
  due_from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  due_to?: string;
}

export class TaskSummaryQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

// ── Routines (branch-scoped) ────────────────────────────────────────────────

export class CreateRoutineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(RoutineFrequency)
  frequency!: RoutineFrequency;

  /** Branch-local wall clock. Read in the branch's own timezone. */
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_of_day must be a 24-hour HH:MM value' })
  time_of_day!: string;

  /**
   * Optional submission deadline on the same branch-local day, not earlier
   * than time_of_day. The generated task is due then instead of the moment it
   * appears.
   */
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'due_time must be a 24-hour HH:MM value' })
  due_time?: string;

  /** Required for WEEKLY: 0 = Sunday … 6 = Saturday, branch-local. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  checklist_template_id?: string;

  @IsOptional()
  @IsUUID()
  default_assignee_id?: string;
}

export class UpdateRoutineDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(RoutineFrequency)
  frequency?: RoutineFrequency;

  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_of_day must be a 24-hour HH:MM value' })
  time_of_day?: string;

  /** Null clears the deadline. */
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'due_time must be a 24-hour HH:MM value' })
  due_time?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  checklist_template_id?: string | null;

  @IsOptional()
  @IsUUID()
  default_assignee_id?: string | null;
}

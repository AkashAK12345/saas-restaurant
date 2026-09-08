import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
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
  ChecklistTemplateStatus,
  RoutineFrequency,
  TaskPriority,
  TaskStatus,
} from '@samco/database';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import { TIME_OF_DAY_PATTERN } from './routine-schedule.js';

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

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;
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

export class ToggleChecklistItemDto {
  @IsBoolean()
  is_done!: boolean;
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
  @IsBoolean()
  @Type(() => Boolean)
  unassigned?: boolean;

  /** Only open tasks whose due time has passed. */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
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

import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** POST /user-groups and PUT /user-groups/:id — a group's name and its whole member list. */
export class SaveUserGroupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  member_ids!: string[];
}

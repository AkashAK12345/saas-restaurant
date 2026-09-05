import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class SetRolePermissionsDto {
  // An array of system-defined permission names (e.g. ['pos.order.create', 'users.view']).
  // The service validates every name exists in the Permission table.
  // Clients cannot create arbitrary permission definitions.
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

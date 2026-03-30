import { IsEnum, IsIn, IsOptional } from 'class-validator';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

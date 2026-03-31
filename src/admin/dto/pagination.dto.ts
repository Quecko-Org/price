// admin/dto/pagination.dto.ts
import { IsOptional, IsInt, Min, IsString, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from './admin.dto';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;



  @IsOptional()
  @IsString()
  email?: string;

  // 🔥 filter by planId (instead of enum)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  planId?: number;

  // 🔍 filter by status
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
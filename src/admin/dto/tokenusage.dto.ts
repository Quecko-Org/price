// admin/dto/token-usage.dto.ts
import { IsOptional, IsEnum } from 'class-validator';

export enum TokenUsageFilter {
  LAST_24_HOURS = '24h',
  LAST_7_DAYS = '7d',
  LAST_30_DAYS = '30d',
}

export class TokenUsageDto {
  @IsOptional()
  @IsEnum(TokenUsageFilter)
  filter?: TokenUsageFilter = TokenUsageFilter.LAST_7_DAYS;
}
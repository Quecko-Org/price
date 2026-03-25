import { IsIn, IsNumber, IsOptional, IsString } from "class-validator";
import { Type } from 'class-transformer';

export class MarketsQueryDto {

  @IsString()
  symbol: string;

  @IsIn(['1m','5m','15m','1h','4h','1w','1d','1M'])
  interval: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  to?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
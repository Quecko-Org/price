import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

export class MarketsQueryDto {

  @IsString()
  symbol: string;

  @IsIn(['1m','5m','15m','1h','4h','1w','1d','1M'])
  interval: string;

  @IsOptional()
  @IsNumber()
  from?: number;

  @IsOptional()
  @IsNumber()
  to?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;
}
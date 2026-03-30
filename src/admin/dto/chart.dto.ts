import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class ChartRangeDto {
  @IsOptional()
  @IsIn(['24h', '7d', '30d'])
  range?: '24h' | '7d' | '30d';
}
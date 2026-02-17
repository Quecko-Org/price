import { IsEnum, IsString, IsArray } from 'class-validator';
import { Exchange } from '@/common/enums/exchanges.enums';

export class CreateSymbolDto {
  @IsString()
  symbol: string;

  @IsString()
  base: string;

  @IsString()
  quote: string;

  @IsArray()
  @IsEnum(Exchange, { each: true })
  exchanges: Exchange[];
}

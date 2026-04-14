import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { MarketDataService } from './market-data.service';


@Controller('api/v1/markets-data')
export class MarketsDataController {

  constructor(
    private readonly marketsDataService: MarketDataService,
 ) { }



@Get('tokens')
async getTokens(
  @Query('page') page = 1,
  @Query('limit') limit = 10,
) {
  return this.marketsDataService.getAllTokens(Number(page), Number(limit));
}

@Get('tokens/:symbol')
async getTokenDetail(@Param('symbol') symbol: string) {
  return this.marketsDataService.getTokenDetail(symbol);
}


}
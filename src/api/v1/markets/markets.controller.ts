import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { MarketsQueryDto } from './dto/markets-query.dto';
import { MarketDataService } from '@/market-data/market-data.service';
import { MarketsService } from './markets.service';


@Controller('api/v1/markets')
export class MarketsController {

  constructor(
    private readonly marketsService: MarketsService,
    private readonly marketDataService: MarketDataService,
  ) { }



  @Get()
  async getCandles(@Query() query: MarketsQueryDto) {

    const market = await this.marketDataService.findBySymbol(query.symbol);
    if (!market) {
      throw new NotFoundException('Symbol not found'); // returns 404
    }

    const candles = await this.marketsService.getMarkets(
      market.id,
      query.interval,
      query.from,
      query.to,
      query.limit,
    );

    return {
      s: 'ok',
      data: candles,
    };
  }


  @Get(':symbol/price')
  async getPrice(@Param('symbol') symbol: string) {

    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) {
      throw new NotFoundException('Symbol not found'); // returns 404
    }
    const {time,price} = await this.marketsService.getLatestPrice(market.id,);

    return {
      symbol,
      price,
      time
    };
  }


  @Get(':symbol/stats')
  async get24hStats(@Param('symbol') symbol: string,) {

    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) {
      throw new NotFoundException('Symbol not found'); // returns 404
    }
    const price = await this.marketsService.get24hStats(market.id
 );

    return {
      symbol,
      price,
    };
  }



}
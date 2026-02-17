import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BinanceService } from './binance.service';
import { BinanceRepository } from './binance.repository';
import { Exchange } from '@/common/enums/exchanges.enums';

@Injectable()
export class BinanceFetcher {
  private readonly logger = new Logger(BinanceFetcher.name);
  constructor(
    private readonly binanceService: BinanceService,
    private readonly priceRepo: BinanceRepository,
  ) {}

  @Cron('*/1 * * * *') // every minute
  async fetchBTC() {
    // console.log("j")
    // const price = await this.binanceService.getPrice('BTCUSDT');
    // await this.priceRepo.savePrice('BTCUSDT', price);
    // this.logger.log(`BTC Price saved: ${price}`);
  }
}

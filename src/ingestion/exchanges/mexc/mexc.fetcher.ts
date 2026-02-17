import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Exchange } from '@/common/enums/exchanges.enums';
import { MexcService } from './mexc.service';
import { MexcRepository } from './mexc.repository';

@Injectable()
export class MexcFetcher {
  private readonly logger = new Logger(MexcFetcher.name);
  constructor(
    private readonly mexcService: MexcService,
    private readonly priceRepo: MexcRepository,
  ) {}

  @Cron('*/1 * * * *') // every minute
  async fetchBTC() {
    // console.log("j")
    // // const price = await this.mexcService.getPrice('BTCUSDT');
    // await this.priceRepo.savePrice('BTCUSDT', price);
    // this.logger.log(`BTC Price saved: ${price}`);
  }
}

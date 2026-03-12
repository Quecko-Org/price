import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BinanceService } from '../exchanges/binance/binance.service';
import { MexcService } from '../exchanges/mexc/mexc.service';

@Injectable()
export class SymbolSyncService {
  private readonly logger = new Logger(SymbolSyncService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly mexcService: MexcService,
  ) { }




  // @Cron('*/1 * * * *')
  async syncAllExchanges() {
    this.logger.log('Starting symbol sync');

    await Promise.allSettled([
      this.binanceService.fetchAndStoreSymbols(),
      this.mexcService.fetchAndStoreSymbols(),
    ]);

    this.logger.log('Symbol sync completed');
  }


}

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
  ) {}

  // Every 10 minutes (example)
  @Cron('*/1 * * * *')
  async syncAllExchanges() {
    this.logger.log('Starting symbol sync for all exchanges');

    await Promise.allSettled([
      // this.binanceService.fetchAndStoreSymbols(),
      // this.mexcService.fetchAndStoreSymbols(),
    ]);
    this.logger.log("start")
    this.logger.log('Symbol sync completed');
  }


}



// { symbol: 'CAKETRY', base: 'CAKE', quote: 'TRY' }
// { symbol: 'GALAFDUSD', base: 'GALA', quote: 'FDUSD' }
// { symbol: 'WLDFDUSD', base: 'WLD', quote: 'FDUSD' }
// { symbol: 'GASTRY', base: 'GAS', quote: 'TRY' }
// { symbol: 'NTRNTRY', base: 'NTRN', quote: 'TRY' }
// { symbol: 'VICTRY', base: 'VIC', quote: 'TRY' }
// { symbol: 'BLURTRY', base: 'BLUR', quote: 'TRY' }
// { symbol: 'USTCTRY', base: 'USTC', quote: 'TRY' }
// { symbol: 'DYDXTRY', base: 'DYDX', quote: 'TRY' }
// { symbol: 'LUNCTRY', base: 'LUNC', quote: 'TRY' }
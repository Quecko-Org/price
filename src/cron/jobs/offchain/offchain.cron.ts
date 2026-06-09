import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OffChainCron {
  constructor(
    // private readonly symbolsService: SymbolsService,
  ) {}

  // // every 1 min
  // @Cron('*/1 * * * *')
  // async updateFxRates() {
  //   console.log('💱 Updating FX rates...');
  //   await this.symbolsService.refreshRates();
  // }
}
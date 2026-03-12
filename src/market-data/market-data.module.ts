




import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import { MarketDataService } from './market-data.service';

import { ExchangesModule } from '@/ingestion/exchanges/exchanges.module';
import { MarketEntity } from './market.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SymbolEntity,MarketEntity]),
    ExchangesModule
  ],
  providers: [
    MarketDataService,
  ],

  exports: [
    MarketDataService
  ],

})
export class MarketDataModule {}

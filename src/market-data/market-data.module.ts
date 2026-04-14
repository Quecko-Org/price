




import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import { MarketDataService } from './market-data.service';

import { ExchangesModule } from '@/ingestion/exchanges/exchanges.module';
import { MarketEntity } from './market.entity';
import { MarketsDataController } from './market-data.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SymbolEntity, MarketEntity]),
    ExchangesModule
  ],
  providers: [
    MarketDataService,
  ],
  controllers: [MarketsDataController],

  exports: [
    MarketDataService
  ],

})
export class MarketDataModule { }



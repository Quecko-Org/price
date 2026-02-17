




import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import { MarketDataService } from './market-data.service';

import { ExchangesModule } from '@/ingestion/exchanges/exchanges.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SymbolEntity]),
    ExchangesModule
  ],
  providers: [
    MarketDataService,
  ],
})
export class MarketDataModule {}

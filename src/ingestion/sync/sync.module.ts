import { Module } from '@nestjs/common';
import { MarketDataSyncService } from './sync.service';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { BackfillJob } from './backfill.job';
import { SymbolsService } from '../symbols/symbol.service';
import { AggregationService } from '@/aggregation/aggregation.service';
import { AggregationModule } from '@/aggregation/aggregation.module';
import { SymbolsModule } from '../symbols/symbols.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolExchangeEntity } from '../symbols/entities/symbol-exchange.entity';
import { SymbolEntity } from '../symbols/entities/symbol.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SymbolExchangeEntity, SymbolEntity]),
    ExchangesModule,
    AggregationModule,
    SymbolsModule
  ],
  providers: [MarketDataSyncService,BackfillJob],
})
export class SyncModule {}

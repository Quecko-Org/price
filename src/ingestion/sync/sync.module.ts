import { Module } from '@nestjs/common';
import { SymbolSyncService } from './sync.service';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { BackfillJob } from './backfill.job';
import { SymbolsService } from '../symbols/symbol.service';
import { AggregationService } from '@/aggregation/aggregation.service';
import { AggregationModule } from '@/aggregation/aggregation.module';
import { SymbolsModule } from '../symbols/symbols.module';

@Module({
  imports: [
    ExchangesModule,
    AggregationModule,
    SymbolsModule
  ],
  providers: [SymbolSyncService,BackfillJob],
})
export class SyncModule {}

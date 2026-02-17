

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candle1mEntity } from './entities/candle-1m.entity';
import { AggregationService } from './aggregation.service';
import { ExchangesModule } from '@/ingestion/exchanges/exchanges.module';
import { SymbolsModule } from '@/ingestion/symbols/symbols.module';
import { SymbolExchangeEntity } from '@/ingestion/symbols/entities/symbol-exchange.entity';

@Module({
    imports: [
      TypeOrmModule.forFeature([
        Candle1mEntity,
        SymbolExchangeEntity
      ]),
      forwardRef(() => ExchangesModule), // ✅ FIX
      SymbolsModule
    ],
    providers: [AggregationService],
    exports: [AggregationService], 
  })
  export class AggregationModule {}
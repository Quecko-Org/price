import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Binance } from './binance.entity';
import { BinanceService } from './binance.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BinanceWebSocket } from './binance.ws';
import { BinanceFetcher } from './binance.fetcher';
import { BinanceRepository } from './binance.repository';
import { SymbolsModule } from '@/ingestion/symbols/symbols.module';
import { AggregationModule } from '@/aggregation/aggregation.module';


@Module({
    imports:[
     TypeOrmModule.forFeature([Binance]),
     ScheduleModule.forRoot(),
     SymbolsModule,
     forwardRef(() => AggregationModule), // ✅ FIX
    
    ],
    providers: [BinanceService, BinanceFetcher, BinanceWebSocket,BinanceRepository ],
    exports: [BinanceService,BinanceWebSocket],

})
export class BinanceModule {}

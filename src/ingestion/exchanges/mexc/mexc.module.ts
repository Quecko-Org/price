import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ScheduleModule } from '@nestjs/schedule';
import { SymbolsModule } from '@/ingestion/symbols/symbols.module';
import { MexcService } from './mexc.service';
import { MexcFetcher } from './mexc.fetcher';
import { MexcWebSocket } from './mexc.ws';
import { MexcRepository } from './mexc.repository';
import { Mexc } from './mexc.entity';
import { HttpModule } from '@nestjs/axios';
import { AggregationModule } from '@/aggregation/aggregation.module';


@Module({
    imports:[
     TypeOrmModule.forFeature([Mexc]),
     ScheduleModule.forRoot(),
     SymbolsModule,
     forwardRef(() => AggregationModule), // ✅ FIX
     HttpModule.register({
        timeout: 10000,
        maxRedirects: 5,
      }),
    ],
    providers: [MexcService, MexcFetcher, MexcWebSocket,MexcRepository ],
    exports: [MexcService,MexcWebSocket],

})
export class MexcModule {}

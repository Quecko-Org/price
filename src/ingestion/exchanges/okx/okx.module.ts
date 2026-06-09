import { Module } from '@nestjs/common';
import { OkxWebSocket } from './oks.ws';
import { OkxService } from './okx.service';
import { SymbolsModule } from '@/ingestion/symbols/symbols.module';

 
@Module({
  imports:[
    SymbolsModule,
   ],
  providers: [OkxService, OkxWebSocket],
  exports:   [OkxService, OkxWebSocket],
})
export class OkxModule {}
 
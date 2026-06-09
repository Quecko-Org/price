import { Module } from '@nestjs/common';
import { BinanceModule } from './binance/binance.module';
import { MexcModule } from './mexc/mexc.module';
import { OkxModule } from './okx/okx.module';

@Module({
  imports: [
    BinanceModule,
    MexcModule,
    OkxModule
  ],
  exports: [
    BinanceModule,
    MexcModule,
    OkxModule
  ],
})
export class ExchangesModule {}

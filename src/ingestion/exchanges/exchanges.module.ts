import { Module } from '@nestjs/common';
import { BinanceModule } from './binance/binance.module';
import { MexcModule } from './mexc/mexc.module';

@Module({
  imports: [
    BinanceModule,
    MexcModule,
  ],
  exports: [
    BinanceModule,
    MexcModule,
  ],
})
export class ExchangesModule {}

import { Module } from '@nestjs/common';
import { UniswapModule } from './uniswap/uniswap.module';
import { AggregationModule } from '@/aggregation/aggregation.module';

@Module({
  imports: [
    UniswapModule,
  ],
  exports: [
    UniswapModule
  ],
})
export class AdapterModule {}
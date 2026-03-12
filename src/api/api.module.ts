import { Module } from '@nestjs/common';
import { MarketsModule } from './v1/markets/markets.module';


@Module({  imports: [
  MarketsModule,
  ],
})
export class ApiModule {}

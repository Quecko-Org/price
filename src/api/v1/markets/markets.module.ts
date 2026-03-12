import { Module } from '@nestjs/common';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';
import { MarketDataModule } from '@/market-data/market-data.module';
import { MarketsRepository } from './markets.repository';

@Module({
  imports: [MarketDataModule],
    controllers: [MarketsController],
    providers: [MarketsService,MarketsRepository],
    exports: [MarketsService],

  })
export class MarketsModule {}

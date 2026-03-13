import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';
import { MarketDataModule } from '@/market-data/market-data.module';
import { MarketsRepository } from './markets.repository';
import { ApiUsageMiddleware } from '@/common/middleware/api-usage/api-usage.middleware';
import { ApiKeyMiddleware } from '@/common/middleware/api-usage/api-key.middleware';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { ApiKeyEntity } from '../api-keys/entities/api-key.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiUsageEntity, ApiKeyEntity]),MarketDataModule
  ],

    controllers: [MarketsController],
    providers: [MarketsService,MarketsRepository],
    exports: [MarketsService],
 
  })
export class MarketsModule implements NestModule{

  configure(consumer: MiddlewareConsumer) {

    consumer
    .apply(ApiKeyMiddleware, ApiUsageMiddleware)
    .forRoutes(MarketsController); 

  }}
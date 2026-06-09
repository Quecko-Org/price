import { Global, Module } from '@nestjs/common';
import { PriceCacheService } from './price-cache-service/price-cache.service';
import { RedisService } from './redis/redis.service';
import { KafkaService } from './kafka/kafka.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candle1mEntity } from '@/aggregation/entities/candle-1m.entity';

@Global() // optional but recommended for common services
@Module({ imports: [
    TypeOrmModule.forFeature([Candle1mEntity]),
  ],
  providers: [
    PriceCacheService,
    RedisService,
    KafkaService,
    // TokenListService,
  ],
  exports: [
    PriceCacheService,
    RedisService,
    KafkaService,
    // TokenListService,
  ],
})
export class CommonModuleModule {}

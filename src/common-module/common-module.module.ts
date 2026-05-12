import { Global, Module } from '@nestjs/common';
import { PriceCacheService } from './price-cache-service/price-cache.service';
import { RedisService } from './redis/redis.service';
import { KafkaService } from './kafka/kafka.service';

@Global() // optional but recommended for common services
@Module({
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

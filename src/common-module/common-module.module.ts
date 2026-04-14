import { Global, Module } from '@nestjs/common';
import { PriceCacheService } from './price-cache-service/price-cache.service';

@Global() // optional but recommended for common services
@Module({
  providers: [
    PriceCacheService,
    // TokenListService,
  ],
  exports: [
    PriceCacheService,
    // TokenListService,
  ],
})
export class CommonModuleModule {}

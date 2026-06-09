import { Test, TestingModule } from '@nestjs/testing';
import { PriceCacheService } from './price-cache.service';

describe('PriceCacheService', () => {
  let service: PriceCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceCacheService],
    }).compile();

    service = module.get<PriceCacheService>(PriceCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

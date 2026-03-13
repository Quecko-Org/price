import { Test, TestingModule } from '@nestjs/testing';
import { ApiUsageService } from './api-usage.service';

describe('ApiUsageService', () => {
  let service: ApiUsageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiUsageService],
    }).compile();

    service = module.get<ApiUsageService>(ApiUsageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ApiUsageController } from './api-usage.controller';

describe('ApiUsageController', () => {
  let controller: ApiUsageController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiUsageController],
    }).compile();

    controller = module.get<ApiUsageController>(ApiUsageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

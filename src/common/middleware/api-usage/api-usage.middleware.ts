import {
  Injectable,
  NestMiddleware,
} from '@nestjs/common';

import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';

@Injectable()
export class ApiUsageMiddleware implements NestMiddleware {

  constructor(
    @InjectRepository(ApiUsageEntity)
    private readonly usageRepo: Repository<ApiUsageEntity>,

    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepo: Repository<ApiKeyEntity>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {

    const start = Date.now();

    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - start;

        const apiKeyId = req['apiKeyId'];
        const userId = req['userId'];

        if (!apiKeyId) return;

        // 1️⃣ Save usage log (source of truth)
        await this.usageRepo.save({
          apiKeyId,
          userId,
          endpoint: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
        });

        // 2️⃣ Update api_keys (fast counters)
        await this.apiKeyRepo.increment(
          { id: apiKeyId },
          'monthlyCalls',
          1,
        );

        await this.apiKeyRepo.update(
          { id: apiKeyId },
          { lastCallAt: new Date() },
        );

      } catch (err) {
        console.error('Usage logging failed:', err);
      }
    });

    next();
  }
}
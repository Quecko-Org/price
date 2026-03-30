import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';
import { UserEntity } from '@/user/entities/user.entity';

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
        await Promise.all([
          this.usageRepo.save({
            apiKeyId,
            userId,
            endpoint: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            responseTime,
            success: res.statusCode >= 200 && res.statusCode < 300 && !res.locals.failed,
          }),

          // Increment per-key monthlyCalls
          this.apiKeyRepo.increment({ id: apiKeyId }, 'monthlyCalls', 1),

          // Update lastCallAt
          this.apiKeyRepo.update({ id: apiKeyId }, { lastCallAt: new Date() }),

          // Increment shared user monthly usage
          this.apiKeyRepo.manager.increment(UserEntity, { id: userId }, 'monthlyUsage', 1),
        ]);
      } catch (err) {
        console.error('Usage logging failed:', err);
      }
    });

    next();
  }
}
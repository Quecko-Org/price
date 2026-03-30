import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';

import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { UserEntity } from '@/user/entities/user.entity';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {

  constructor(
    @InjectRepository(ApiKeyEntity)
    private apiKeyRepo: Repository<ApiKeyEntity>,

    @InjectRepository(ApiUsageEntity)
    private apiUsageRepo: Repository<ApiUsageEntity>,
  ) { }

  async use(req: Request, res: Response, next: NextFunction) {

    const apiKeyHeader = req.headers['x-api-key'];
    if (!apiKeyHeader) throw new UnauthorizedException('API key required');

    const key = await this.apiKeyRepo.findOne({
      where: { key: apiKeyHeader as string },
      relations: ['user', 'user.plan'], // 🔥 IMPORTANT
    });


    if (!key) throw new UnauthorizedException('Invalid API key');

    const user = key.user as UserEntity;
    
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account suspended');
    }

    // 🔹 Check plan expiry
    if (user.planExpiresAt && new Date() > user.planExpiresAt) {
      throw new ForbiddenException('User plan expired');
    }

    // 🔹 Monthly usage reset
    const now = new Date();
    if (!user.usageResetAt || now.getMonth() !== user.usageResetAt.getMonth()) {
      await this.apiKeyRepo.manager.update(UserEntity, user.id, {
        monthlyUsage: 0,
        usageResetAt: now,
      });
      user.monthlyUsage = 0;
    }

    const planLimits = key.user.plan;

    if (user.monthlyUsage >= planLimits?.monthlyApiCalls) {
      throw new ForbiddenException('Monthly API limit exceeded');
    }
    console.log("planlimit", user, planLimits)
    // 🔹 Endpoint checks
    const path = req.path.toLowerCase();
    const query = req.query;

    const isHistorical =
      path === '/api/v1/markets' &&
      query['symbol'] &&
      query['interval'] &&
      (query['from'] || query['to']);
    if (isHistorical && !planLimits?.historicalData) {
      throw new ForbiddenException('Upgrade plan for historical/realtime data');
    }

    if (path.endsWith('/price') && !planLimits?.realtimeData) {
      // throw new ForbiddenException('Upgrade plan for realtime data');
    }

    if (path.endsWith('/stats') && !planLimits?.marketOverview) {
      throw new ForbiddenException('Upgrade plan for market overview');
    }

    if (path.includes('onchain') && !planLimits?.onchainMetrics) {
      throw new ForbiddenException('Upgrade plan for on-chain data');
    }

    // Attach user & key to request
    req['userId'] = user.id;
    req['apiKeyId'] = key.id;
    req['plan'] = planLimits;

    next();
  }
}
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

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {

  constructor(
    @InjectRepository(ApiKeyEntity)
    private apiKeyRepo: Repository<ApiKeyEntity>,

    @InjectRepository(ApiUsageEntity)
    private apiUsageRepo: Repository<ApiUsageEntity>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {

    const apiKeyHeader = req.headers['x-api-key'];

    if (!apiKeyHeader) {
      throw new UnauthorizedException('API key required');
    }

    // 1️⃣ Find API key with plan + user
    const key = await this.apiKeyRepo.findOne({
      where: { key: apiKeyHeader as string },
      relations: ['user', 'plan'],
    });

    if (!key) {
      throw new UnauthorizedException('Invalid API key');
    }

    const plan = key.plan;

    // 2️⃣ Check monthly usage (from api_usage table)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyUsage = await this.apiUsageRepo.count({
      where: {
        apiKeyId: key.id,
        createdAt: MoreThan(startOfMonth),
      },
    });

    if (monthlyUsage >= plan.monthlyApiCalls) {
      throw new ForbiddenException('Monthly API limit exceeded');
    }

    // 3️⃣ (Optional) Endpoint access control
    const path = req.path.toLowerCase();
    const query = req.query;

    // 🔹 3a. Real-time / historical candles
    // pattern: /api/v1/markets?symbol=BTC&interval=1m&from=...&to=...
    const isHistoricalData =
      path === '/api/v1/markets' &&
      query['symbol'] &&
      query['interval'] &&
      (query['from'] || query['to']);

    if (isHistoricalData && !plan.historicalData) {
      throw new ForbiddenException('Upgrade plan for real-time/historical data');
    }

    // 🔹 3b. Price endpoint
    // pattern: /api/v1/markets/BTC/price
    if (!plan.realtimeData && path.endsWith('/price')) {
      // optionally restrict by plan if needed
    }

    // 🔹 3c. Market overview
    // pattern: /api/v1/markets/BTC/stats
    if (path.endsWith('/stats') && !plan.marketOverview) {
      throw new ForbiddenException('Upgrade plan for market overview');
    }


    if (!plan.historicalData && path.includes('history')) {
      throw new ForbiddenException('Upgrade plan for historical data');
    }

    if (!plan.onchainMetrics && path.includes('onchain')) {
      throw new ForbiddenException('Upgrade plan for on-chain data');
    }

    // 4️⃣ Attach to request (used later)
    req['userId'] = key.user.id;
    req['apiKeyId'] = key.id;
    req['plan'] = plan;

    next();
  }
}
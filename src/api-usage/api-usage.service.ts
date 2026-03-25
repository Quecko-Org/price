import { Injectable } from '@nestjs/common';
import { ApiUsageEntity } from './entities/api-usage.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';

@Injectable()
export class ApiUsageService {

    constructor(
        @InjectRepository(ApiUsageEntity)
        private usageRepo: Repository<ApiUsageEntity>,
        @InjectRepository(SymbolEntity)
        private readonly symbolRepo: Repository<SymbolEntity>,
      ) {}

      async getOverview(userId: number) {

        const now = new Date();
      
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
        const result = await this.usageRepo
          .createQueryBuilder('u')
          .select([
            `COUNT(*) FILTER (WHERE u."createdAt" >= :startOfMonth) AS "monthlyRequests"`,
            `COUNT(*) FILTER (WHERE u."createdAt" >= :last24h) AS "last24hRequests"`,
            `COUNT(*) FILTER (WHERE u."statusCode" >= 200 AND u."statusCode" < 300) AS "successRequests"`,
            `COUNT(*) AS "totalRequests"`,
            `AVG(u."responseTime") AS "avgResponseTime"`
          ])
          .where('u."userId" = :userId', { userId })
          .setParameters({ startOfMonth, last24h })
          .getRawOne();
      
        const monthly = Number(result.monthlyRequests || 0);
        const last24hCount = Number(result.last24hRequests || 0);
        const total = Number(result.totalRequests || 0);
        const success = Number(result.successRequests || 0);
      
        return {
          totalRequests: total,
      
          monthlyRequests: monthly,
      
          last24hRequests: last24hCount,
      
          last24hPercentage: monthly
            ? Number(((last24hCount / monthly) * 100).toFixed(2))
            : 0,
      
          successRate: total
            ? Number(((success / total) * 100).toFixed(2))
            : 0,
      
          avgResponseTime: Number(result.avgResponseTime || 0),
        };
      }

      async getDailyUsage(userId: number) {

        return this.usageRepo
          .createQueryBuilder('u')
          .select([
            `DATE(u."createdAt") as date`,
            `COUNT(*) as requests`
          ])
          .where('u."userId" = :userId', { userId })
          .andWhere(`u."createdAt" >= NOW() - INTERVAL '30 days'`)
          .groupBy(`DATE(u."createdAt")`)
          .orderBy(`DATE(u."createdAt")`, 'ASC')
          .getRawMany();
      }


      async getUsagePerKey(userId: number) {

        return this.usageRepo
          .createQueryBuilder('u')
          .select([
            'u."apiKeyId" as "apiKeyId"',
            'COUNT(*) as "requests"',
            'AVG(u."responseTime") as "avgResponseTime"'
          ])
          .where('u."userId" = :userId', { userId })
          .groupBy('u."apiKeyId"')
          .orderBy('"requests"', 'DESC')
          .getRawMany();
      }


      async getTopEndpoints(userId: number) {

        return this.usageRepo
          .createQueryBuilder('u')
          .select([
            'u."endpoint" as endpoint',
            'COUNT(*) as requests'
          ])
          .where('u."userId" = :userId', { userId })
          .groupBy('u."endpoint"')
          .orderBy('requests', 'DESC')
          .limit(10)
          .getRawMany();
      }


      async getGlobalOverview() {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
        const result = await this.usageRepo
          .createQueryBuilder('u')
          .select([
            `COUNT(*) FILTER (WHERE u."createdAt" >= :startOfMonth) AS "monthlyRequests"`,
            `COUNT(*) FILTER (WHERE u."createdAt" >= :last24h) AS "last24hRequests"`,
            `COUNT(*) FILTER (WHERE u."statusCode" >= 200 AND u."statusCode" < 300) AS "successRequests"`,
            `COUNT(*) FILTER (WHERE u."statusCode" >= 400 AND u."statusCode" < 500) AS "clientErrors"`,
            `COUNT(*) FILTER (WHERE u."statusCode" >= 500) AS "serverErrors"`,
            `COUNT(*) AS "totalRequests"`,
            `AVG(u."responseTime") AS "avgResponseTime"`,
          ])
          .setParameters({ startOfMonth, last24h })
          .getRawOne();
    
        const monthly = Number(result.monthlyRequests || 0);
        const last24hCount = Number(result.last24hRequests || 0);
        const total = Number(result.totalRequests || 0);
        const success = Number(result.successRequests || 0);
        const clientErrors = Number(result.clientErrors || 0);
        const serverErrors = Number(result.serverErrors || 0);
    



        const symbols= await this.symbolRepo.count();
        return {
          totalRequests: total,
          monthlyRequests: monthly,
          last24hRequests: last24hCount,
          last24hPercentage: monthly
            ? Number(((last24hCount / monthly) * 100).toFixed(2))
            : 0,
          successRate: total
            ? Number(((success / total) * 100).toFixed(2))
            : 0,
          clientErrors,
          serverErrors,
          avgResponseTime: Number(result.avgResponseTime || 0),
          symbols,
          blockchianNetwork:1,
          supportedExchanges:3,
        };
      }
}

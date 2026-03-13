import { Injectable } from '@nestjs/common';
import { ApiUsageEntity } from './entities/api-usage.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ApiUsageService {

    constructor(
        @InjectRepository(ApiUsageEntity)
        private usageRepo: Repository<ApiUsageEntity>,
      ) {}

    async getOverview(userId: number) {

        const totalRequests = await this.usageRepo.count({
          where: { userId }
        });
      
        const successRequests = await this.usageRepo.count({
          where: {
            userId,
            statusCode: 200
          }
        });
      
        const avg = await this.usageRepo
          .createQueryBuilder('u')
          .select('AVG(u.responseTime)', 'avg')
          .where('u.userId = :userId', { userId })
          .getRawOne();
      
        return {
          totalRequests,
          successRate: totalRequests
            ? (successRequests / totalRequests) * 100
            : 0,
          avgResponseTime: Number(avg.avg || 0)
        };
      }


      async getDailyUsage(userId: number) {

        const data = await this.usageRepo.query(`
          SELECT
            DATE("createdAt") as date,
            COUNT(*) as requests
          FROM api_usage
          WHERE "userId" = $1
          AND "createdAt" >= now() - interval '30 days'
          GROUP BY DATE("createdAt")
          ORDER BY DATE("createdAt")
        `,[userId]);
      
        return data;
      }
}

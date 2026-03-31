import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserEntity } from '@/user/entities/user.entity';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
import { UserStatus } from './dto/admin.dto';
import { TokenUsageDto, TokenUsageFilter } from './dto/tokenusage.dto';
import { PlanEntity } from '@/api/v1/payments/entities/payemnt-plan';
import { CreatePlanDto, UpdatePlanDto } from './dto/payment.dto';

@Injectable()
export class AdminService {

  constructor(
    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,

    @InjectRepository(ApiUsageEntity)
    private usageRepo: Repository<ApiUsageEntity>,

    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,


    @InjectRepository(PlanEntity)
    private readonly planRepo: Repository<PlanEntity>,


  ) { }

  // ===============================
  // 📊 USERS STATS
  // ===============================
  async getUsersStats() {
    const now = new Date();

    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const result = await this.userRepo
      .createQueryBuilder('u')
      .select([
        `COUNT(*) FILTER (WHERE u."createdAt" >= :thisMonth) as "current"`,
        `COUNT(*) FILTER (WHERE u."createdAt" >= :lastMonth AND u."createdAt" < :thisMonth) as "previous"`,
        `COUNT(*) as "total"`
      ])
      .setParameters({ thisMonth, lastMonth })
      .getRawOne();

    const current = Number(result.current);
    const previous = Number(result.previous);

    return {
      totalUsers: Number(result.total),
      growthPercentage: previous
        ? Number((((current - previous) / previous) * 100).toFixed(2))
        : 100,
    };
  }

  // ===============================
  // 📊 ACTIVE USERS
  // =============================== 
  async getActiveUsersStats() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 86400000);
    const prev24h = new Date(now.getTime() - 2 * 86400000);

    const result = await this.usageRepo
      .createQueryBuilder('u')
      .select([
        `COUNT(DISTINCT u."userId") FILTER (WHERE u."createdAt" >= :last24h) as "current"`,
        `COUNT(DISTINCT u."userId") FILTER (
          WHERE u."createdAt" >= :prev24h AND u."createdAt" < :last24h
        ) as "previous"`
      ])
      .setParameters({ last24h, prev24h })
      .getRawOne();

    const current = Number(result.current);
    const previous = Number(result.previous);

    return {
      activeUsers: current,
      percentage: previous
        ? Number((((current - previous) / previous) * 100).toFixed(2))
        : 100,
    };
  }

  // ===============================
  // 📊 API REQUESTS
  // ===============================
  async getApiRequestsStats() {
    const result = await this.usageRepo.query(`
      SELECT
        COUNT(*) FILTER (WHERE DATE("createdAt") = CURRENT_DATE) as today,
        COUNT(*) FILTER (WHERE DATE("createdAt") = CURRENT_DATE - INTERVAL '1 day') as yesterday
      FROM api_usage
    `);

    const today = Number(result[0].today);
    const yesterday = Number(result[0].yesterday);

    return {
      todayRequests: today,
      percentageYesterday: yesterday
        ? Number((((today - yesterday) / yesterday) * 100).toFixed(2))
        : 100,
    };
  }

  // ===============================
  // 💰 REVENUE
  // ===============================
  async getRevenueStats() {
    const result = await this.paymentRepo.query(`
      SELECT
        SUM("amountCurrency") FILTER (
          WHERE DATE_TRUNC('month', "createdAt") = DATE_TRUNC('month', CURRENT_DATE)
        ) as current,

        SUM("amountCurrency") FILTER (
          WHERE DATE_TRUNC('month', "createdAt") = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        ) as previous
      FROM payments
      WHERE status = 'confirmed'
    `);

    const current = Number(result[0].current || 0);
    const previous = Number(result[0].previous || 0);

    return {
      revenue: current,
      percentage: previous
        ? Number((((current - previous) / previous) * 100).toFixed(2))
        : 100,
    };
  }

  // ===============================
  // 📈 API CHART
  // ===============================
  async getApiChart(range: '24h' | '7d' | '30d' = '7d') {
    const interval = range === '24h' ? 'hour' : 'day';
    const duration =
      range === '24h' ? '24 hours' :
        range === '7d' ? '7 days' : '30 days';

    return this.usageRepo.query(`
      SELECT
        DATE_TRUNC('${interval}', "createdAt") as time,
        COUNT(*) as value
      FROM api_usage
      WHERE "createdAt" >= NOW() - INTERVAL '${duration}'
      GROUP BY time
      ORDER BY time
    `);
  }

  // ===============================
  // 📈 ACTIVE USERS CHART
  // ===============================
  async getActiveUsersChart(range: '24h' | '7d' | '30d' = '7d') {
    const duration =
      range === '24h' ? '24 hours' :
        range === '7d' ? '7 days' : '30 days';

    return this.usageRepo.query(`
      SELECT
        DATE_TRUNC('day', "createdAt") as date,
        COUNT(DISTINCT "userId") as users
      FROM api_usage
      WHERE "createdAt" >= NOW() - INTERVAL '${duration}'
      GROUP BY date
      ORDER BY date
    `);
  }

  // ===============================
  // 👤 USERS
  // ===============================






  async getAllUsers(page = 1, limit = 20) {
    const [users, total] = await this.userRepo.findAndCount({
      relations: ['plan'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: users,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }


  async getUserDetails(userId: number) {
    // User basic info + plan + payments
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['plan', 'payments'],
    });

    if (!user) return null;

    // Total usage, last 30 days, today
    const usage = await this.usageRepo.query(
      `
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days') AS monthly,
      COUNT(*) FILTER (WHERE DATE("createdAt") = CURRENT_DATE) AS today
    FROM api_usage
    WHERE "userId" = $1
    `,
      [userId],
    );

    // 7-day usage history (for chart)
    const last7Days = await this.usageRepo.query(
      `
    SELECT
      DATE("createdAt") AS day,
      COUNT(*) AS usage
    FROM api_usage
    WHERE "userId" = $1
      AND "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY day
    ORDER BY day ASC
    `,
      [userId],
    );

    return {
      user,
      usage: usage[0],
      last7Days,
    };
  }











  async updateUserStatus(userId: number, status: UserStatus) {
    await this.userRepo.update(userId, { status });
    return { message: 'User status updated' };
  }



  async getTokenUsage(dto: TokenUsageDto) {
    let startDate: Date;
    const now = new Date();

    switch (dto.filter) {
      case TokenUsageFilter.LAST_24_HOURS:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case TokenUsageFilter.LAST_7_DAYS:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case TokenUsageFilter.LAST_30_DAYS:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Aggregate by API key and symbol
    const usage = await this.usageRepo
      .createQueryBuilder('u')
      .select([

        'u."apiKeyId" AS apikeyid',   // lowercase
        'u.endpoint',
        'COUNT(*) AS requestcount',
      ])
      .where('u."createdAt" >= :startDate', { startDate })
      .groupBy('u."apiKeyId"')
      .addGroupBy('u.endpoint')
      .orderBy("requestCount", 'DESC')
      .getRawMany();

    // Parse symbol from endpoint query/path
    const result = usage.map(u => {
      let symbol: any = null;
      try {
        if (u.endpoint.includes('/api/v1/markets?')) {
          const queryStr = u.endpoint.split('?')[1];
          const params = new URLSearchParams(queryStr);

          symbol = params.get('symbol');

        } else if (u.endpoint.includes('/api/v1/markets/') && u.endpoint.includes('/price')) {
          symbol = u.endpoint.split('/')[3]; // /api/v1/markets/BTC/price
        } else if (u.endpoint.includes('/api/v1/markets/') && u.endpoint.includes('/stats')) {
          symbol = u.endpoint.split('/')[3]; // /api/v1/markets/BTC/stats
        }
      } catch (err) {
        symbol = null;
      }

      return {
        apiKeyId: u.apikeyid,          // lowercase
        endpoint: u.endpoint,
        symbol,
        requestCount: Number(u.requestcount), // lowercase
      };
    });

    return result;
  }









  async create(dto: CreatePlanDto) {
    const plan = this.planRepo.create(dto);
    return this.planRepo.save(plan);
  }

  async update(planId: number, dto: UpdatePlanDto) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    Object.assign(plan, dto);
    return this.planRepo.save(plan);
  }

  async disable(planId: number) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    plan['disabled'] = true;
    return this.planRepo.save(plan);
  }

  async enable(planId: number) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    plan['disabled'] = false;
    return this.planRepo.save(plan);
  }

  async getAll() {
    return this.planRepo.find({ order: { planIndex: 'ASC' } });
  }

  async getById(planId: number) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }
}
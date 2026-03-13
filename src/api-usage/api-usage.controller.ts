
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiUsageService } from './api-usage.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('api/v1/usage')
export class ApiUsageController {
  constructor(private readonly apiUsageService: ApiUsageService) {}

  /**
   * GET /api/v1/usage/overview
   * Returns total requests, success rate, and average response time for the authenticated user
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('overview')
  async getOverview(@Req() req) {
    const userId = req.user.id;
    const overview = await this.apiUsageService.getOverview(userId);
    return {
      success: true,
      data: overview,
    };
  }

  /**
   * GET /api/v1/usage/daily
   * Returns daily request counts for the last 30 days
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('daily')
  async getDailyUsage(@Req() req) {
    const userId = req.user.id;
    const dailyData = await this.apiUsageService.getDailyUsage(userId);
    return {
      success: true,
      data: dailyData,
    };
  }
}
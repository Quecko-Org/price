
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
  async getUsagePerKey(@Req() req) {
    const userId = req.user.id;
    const dailyData = await this.apiUsageService.getDailyUsage(userId);
    return {
      success: true,
      data: dailyData,
    };
  }


  @UseGuards(AuthGuard('jwt'))
  @Get('daily-key-usage')
  async getDailyUsagePerKey(@Req() req) {
    const userId = req.user.id;
    const dailyData = await this.apiUsageService.getUsagePerKey(userId);
    return {
      success: true,
      data: dailyData,
    };
  }



  @UseGuards(AuthGuard('jwt'))
  @Get('daily-endpoints-usage')
  async getTopEndpoints(@Req() req) {
    const userId = req.user.id;
    const Data = await this.apiUsageService.getTopEndpoints(userId);
    return {
      success: true,
      data: Data,
    };
  }



  @UseGuards(AuthGuard('jwt'))
  @Get('global-overview')
  async getGlobalOverview(@Req() req) {
    const dailyData = await this.apiUsageService.getGlobalOverview();
    return {
      success: true,
      data: dailyData,
    };
  }
  
  

}
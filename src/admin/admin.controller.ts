import {
    Controller,
    Get,
    Patch,
    Param,
    Query,
    Body,
    UseGuards,
    Post,
  } from '@nestjs/common';
  
  import { AdminService } from './admin.service';
  import { AuthGuard } from '@nestjs/passport';
  import { AdminGuard } from '@/common/guards/admin.guard';
import { UpdateUserStatusDto } from './dto/admin.dto';
import { ChartRangeDto } from './dto/chart.dto';
import { PaginationDto } from './dto/pagination.dto';
import { TokenUsageDto } from './dto/tokenusage.dto';
import { CreatePlanDto, UpdatePlanDto } from './dto/payment.dto';
  
  
  @Controller('admin')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  export class AdminController {
  
    constructor(private readonly adminService: AdminService) {}
  
    // 📊 Dashboard
    @Get('users-stats')
    getUsersStats() {
      return this.adminService.getUsersStats();
    }
  
    @Get('active-users')
    getActiveUsers() {
      return this.adminService.getActiveUsersStats();
    }
  
    @Get('api-requests')
    getApiRequests() {
      return this.adminService.getApiRequestsStats();
    }
  
    @Get('revenue')
    getRevenue() {
      return this.adminService.getRevenueStats();
    }
  
    // 📈 Charts
    @Get('charts/api')
    getApiChart(@Query() query: ChartRangeDto) {
      return this.adminService.getApiChart(query.range);
    }
  
    @Get('charts/users')
    getUsersChart(@Query() query: ChartRangeDto) {
      return this.adminService.getActiveUsersChart(query.range);
    }
  
    // 👤 Users
    @Get('users')
    getAllUsers(@Query() query: PaginationDto) {
      return this.adminService.getAllUsers(query);
    }

    @Get('token-usage')
    getTokenUsage(@Query() query: TokenUsageDto) {
      return this.adminService.getTokenUsage(query);
    }
  
    @Get('users/:id')
    getUser(@Param('id') id: number) {
      return this.adminService.getUserDetails(id);
    }
  
    @Patch('users/:id/status')
    updateStatus(
      @Param('id') id: number,
      @Body() dto: UpdateUserStatusDto,
    ) {
      return this.adminService.updateUserStatus(id, dto.status);
    }





    @Post('plan')
    create(@Body() dto: CreatePlanDto) {
      return this.adminService.create(dto);
    }
  
    @Patch('plan/:id')
    update(@Param('id') id: number, @Body() dto: UpdatePlanDto) {
      return this.adminService.update(id, dto);
    }
  
    @Patch('plan/:id/disable')
    disable(@Param('id') id: number) {
      return this.adminService.disable(id);
    }
  
    @Patch('plan/:id/enable')
    enable(@Param('id') id: number) {
      return this.adminService.enable(id);
    }
  
    @Get('plan')
    list() {
      return this.adminService.getAll();
    }
  
    @Get('plan/:id')
    get(@Param('id') id: number) {
      return this.adminService.getById(id);
    }


    
  }
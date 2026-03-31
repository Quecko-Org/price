// src/api/v1/payments/dto/plan.dto.ts
import { IsEnum, IsNumber, IsOptional, IsBoolean, IsString } from 'class-validator';
import { UserPlan } from '@/common/enums/payment.enum';

export class CreatePlanDto {
  @IsEnum(UserPlan)
  name: UserPlan;

  @IsNumber()
  planIndex: number;

  @IsNumber()
  priceUsd: number;

  @IsNumber()
  maxApiKeys: number;

  @IsNumber()
  maxEndpoints: number;

  @IsNumber()
  monthlyApiCalls: number;

  @IsBoolean()
  realtimeData: boolean;

  @IsBoolean()
  historicalData: boolean;

  @IsBoolean()
  marketOverview: boolean;

  @IsBoolean()
  onchainMetrics: boolean;

  @IsBoolean()
  chartData: boolean;

  @IsOptional()
  @IsString()
  supportLevel?: 'community' | 'email' | 'priority';
}

export class UpdatePlanDto {
  @IsOptional()
  @IsEnum(UserPlan)
  name?: UserPlan;

  @IsOptional()
  @IsNumber()
  planIndex?: number;

  @IsOptional()
  @IsNumber()
  priceUsd?: number;

  @IsOptional()
  @IsNumber()
  maxApiKeys?: number;

  @IsOptional()
  @IsNumber()
  maxEndpoints?: number;

  @IsOptional()
  @IsNumber()
  monthlyApiCalls?: number;

  @IsOptional()
  @IsBoolean()
  realtimeData?: boolean;

  @IsOptional()
  @IsBoolean()
  historicalData?: boolean;

  @IsOptional()
  @IsBoolean()
  marketOverview?: boolean;

  @IsOptional()
  @IsBoolean()
  onchainMetrics?: boolean;

  @IsOptional()
  @IsBoolean()
  chartData?: boolean;

  @IsOptional()
  @IsString()
  supportLevel?: 'community' | 'email' | 'priority';

  @IsOptional()
  @IsBoolean()
  disabled?: boolean; // admin can disable plan
}
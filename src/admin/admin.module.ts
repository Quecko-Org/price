import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
import { UserEntity } from '@/user/entities/user.entity';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanEntity } from '@/api/v1/payments/entities/payemnt-plan';
import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ UserEntity
    ,ApiUsageEntity,PaymentEntity ,PlanEntity ,ApiKeyEntity])],


  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}




import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApiKeyEntity } from './entities/api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { UserEntity } from '@/user/entities/user.entity';
import { PlanEntity } from '../payments/entities/payemnt-plan';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKeyEntity,UserEntity,PlanEntity
  ])],
  providers: [ApiKeysService],
  controllers: [ApiKeysController],
})
export class ApiKeysModule {}
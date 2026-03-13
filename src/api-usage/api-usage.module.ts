import { Module } from '@nestjs/common';
import { ApiUsageController } from './api-usage.controller';
import { ApiUsageService } from './api-usage.service';
import { ApiUsageEntity } from './entities/api-usage.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([ApiUsageEntity])],
  controllers: [ApiUsageController],
  providers: [ApiUsageService]
})
export class ApiUsageModule {}
 
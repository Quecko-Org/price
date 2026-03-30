import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';

import { ApiKeyEntity } from './entities/api-key.entity';
import { UserEntity } from '@/user/entities/user.entity';
import { CreateApiKeyDto } from './dto/api-keys.dto';
import { PlanEntity } from '../payments/entities/payemnt-plan';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKeyEntity)
    private apiKeyRepo: Repository<ApiKeyEntity>,

    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,

    @InjectRepository(PlanEntity)
    private planRepo: Repository<PlanEntity>,
  ) {}

  // -------------------------
  // Generate API Key
  // -------------------------
  generateKey() {
    return 'api_' + randomBytes(32).toString('hex');
  }

  // -------------------------
  // Create API Key
  // -------------------------
  async create(user: UserEntity, dto: CreateApiKeyDto) {

    // 1️⃣ Get user with plan
    const fullUser = await this.userRepo.findOne({
      where: { id: user.id },
    });

    if (!fullUser) {
      throw new NotFoundException('User not found');
    }

    // 2️⃣ Map enum → PlanEntity
    const plan = await this.planRepo.findOne({
      where: { name: fullUser.currentPlan }
        });

    if (!plan) {
      throw new NotFoundException('Plan configuration not found');
    }

    // 3️⃣ Check max API keys
    const existingKeysCount = await this.apiKeyRepo.count({
      where: { user: { id: user.id } },
    });

    if (existingKeysCount >= plan.maxApiKeys) {
      throw new BadRequestException(
        `API key limit reached (${plan.maxApiKeys}). Delete old keys to create new ones.`,
        );
    }

    // 4️⃣ Generate key
    const key = this.generateKey();

    // 5️⃣ Create API key
    const apiKey = this.apiKeyRepo.create({
      user: fullUser,
      name: dto.name,
      key,
      // plan,
      // monthlyCalls: 0,
    });

    return this.apiKeyRepo.save(apiKey);
  }

  // -------------------------
  // List API Keys
  // -------------------------
  async list(userId: number) {
    return this.apiKeyRepo.find({
      where: { user: { id: userId } },
      relations: ['plan'], // ✅ include plan info
      order: { createdAt: 'DESC' },
    });
  }

  // -------------------------
  // Delete API Key
  // -------------------------
  async delete(userId: number, id: number) {

    const key = await this.apiKeyRepo.findOne({
      where: { id, user: { id: userId } },
    });

    if (!key) {
      throw new NotFoundException('API key not found');
    }

    await this.apiKeyRepo.remove(key);

    return { message: 'API key deleted' };
  }
}


import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as crypto from 'crypto';

import { ApiKeyEntity } from './entities/api-key.entity';
import { UserEntity } from '@/user/entities/user.entity';
import { CreateApiKeyDto } from './dto/api-keys.dto';

@Injectable()
export class ApiKeysService {

  constructor(
    @InjectRepository(ApiKeyEntity)
    private apiKeyRepo: Repository<ApiKeyEntity>,
  ) {}

  generateKey() {
    return 'api_' + randomBytes(32).toString('hex');
  }

  async create(user: UserEntity, dto: CreateApiKeyDto) {

    const key = this.generateKey();
    // const hash = crypto
    // .createHash('sha256')
    // .update(key)
    // .digest('hex');
    const apiKey = this.apiKeyRepo.create({
      user,
      name: dto.name,
      key,
    });

    return this.apiKeyRepo.save(apiKey);
  }

  async list(userId: number) {

    return this.apiKeyRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }

  async delete(userId: number, id: number) {

    const key = await this.apiKeyRepo.findOne({
      where: { id, user: { id: userId } },
    });

    if (!key) throw new NotFoundException('API key not found');

    await this.apiKeyRepo.remove(key);

    return { message: 'API key deleted' };
  }
}
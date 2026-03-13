import {
    Injectable,
    NestMiddleware,
    UnauthorizedException,
  } from '@nestjs/common';
  
  import { Request, Response, NextFunction } from 'express';
  import { InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
  
  import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';
  
  @Injectable()
  export class ApiKeyMiddleware implements NestMiddleware {
  
    constructor(
      @InjectRepository(ApiKeyEntity)
      private apiKeyRepo: Repository<ApiKeyEntity>,
    ) {}
  
    async use(req: Request, res: Response, next: NextFunction) {
  
      const apiKey = req.headers['x-api-key'];
  
      if (!apiKey)
        throw new UnauthorizedException('API key required');
  
      const key = await this.apiKeyRepo.findOne({
        where: { key: apiKey as string },
        relations: ['user'],
      });
  
      if (!key)
        throw new UnauthorizedException('Invalid API key');
  
      req['userId'] = key.user.id;
      req['apiKeyId'] = key.id;
  
      next();
    }
  }
import {
    Injectable,
    NestMiddleware,
  } from '@nestjs/common';
  
  import { Request, Response, NextFunction } from 'express';
  
  import { InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
  
  
  @Injectable()
  export class ApiUsageMiddleware implements NestMiddleware {
  
    constructor(
      @InjectRepository(ApiUsageEntity)
      private readonly usageRepo: Repository<ApiUsageEntity>,
    ) {}
  
    async use(req: Request, res: Response, next: NextFunction) {
  
      const start = Date.now();
  
      res.on('finish', async () => {
        try {
  
          const responseTime = Date.now() - start;
  
          const apiKeyId = req['apiKeyId'];
          const userId = req['userId'];
  
          // skip logging if api key missing
          if (!apiKeyId) return;
  
          await this.usageRepo.save({
            apiKeyId,
            userId,
            endpoint: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            responseTime,
          });
  
        } catch (err) {
          console.error('Usage logging failed:', err);
        }
      });
  
      next();
    }
  }
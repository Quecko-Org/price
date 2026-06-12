import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const TTL = { PRICE: 120, CANDLE: 120, FX: 600, STATS: 60 };

function buildOpts() {
  return {
    host:                 process.env.REDIS_HOST     ?? 'localhost',
    port:                 Number(process.env.REDIS_PORT ?? 6379),
    // || undefined so empty string doesn't get sent as password
    password:             process.env.REDIS_PASSWORD || undefined,
    retryStrategy:        (times: number) => Math.min(times * 200, 3_000),
    enableReadyCheck:     true,
    maxRetriesPerRequest: 3,
  };
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client:     Redis;
  private publisher:  Redis;
  private subscriber: Redis;

  constructor() {
    const opts = buildOpts();
    this.client     = new Redis(opts);
    this.publisher  = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.client.on('connect',     () => this.logger.log('✅ Redis client connected'));
    this.publisher.on('connect',  () => this.logger.log('✅ Redis publisher connected'));
    this.subscriber.on('connect', () => this.logger.log('✅ Redis subscriber connected'));
    this.client.on('error',     e => this.logger.error(`Redis client error: ${e?.message}`));
    this.publisher.on('error',  e => this.logger.error(`Redis publisher error: ${e?.message}`));
    this.subscriber.on('error', e => this.logger.error(`Redis subscriber error: ${e?.message}`));
  }

  async setPrice(symbol: string, priceUsd: number): Promise<void> {
    await this.client.setex(`price:${symbol}`, TTL.PRICE, priceUsd.toString());
  }

  async getPrice(symbol: string): Promise<number | null> {
    const v = await this.client.get(`price:${symbol}`);
    return v ? Number(v) : null;
  }

  async getAllPrices(): Promise<Map<string, number>> {
    try {
      const keys = await this.client.keys('price:*');
      if (!keys.length) return new Map();
      const values = await this.client.mget(...keys);
      const result = new Map<string, number>();
      keys.forEach((k, i) => {
        const val = values[i];
        if (val) result.set(k.replace('price:', ''), Number(val));
      });
      return result;
    } catch (err: any) {
      this.logger.error(`getAllPrices failed: ${err?.message}`);
      return new Map();
    }
  }

  async setLatestCandle(marketId: number, candle: object): Promise<void> {
    await this.client.setex(`candle:latest:${marketId}`, TTL.CANDLE, JSON.stringify(candle));
  }

  async getLatestCandle(marketId: number): Promise<object | null> {
    const v = await this.client.get(`candle:latest:${marketId}`);
    return v ? JSON.parse(v) : null;
  }

  async set24hStats(marketId: number, stats: object): Promise<void> {
    await this.client.setex(`stats24h:${marketId}`, TTL.STATS, JSON.stringify(stats));
  }

  async get24hStats(marketId: number): Promise<object | null> {
    const v = await this.client.get(`stats24h:${marketId}`);
    return v ? JSON.parse(v) : null;
  }

  async setFxRates(rates: Record<string, number>): Promise<void> {
    await this.client.setex('fx:rates', TTL.FX, JSON.stringify(rates));
  }

  async getFxRates(): Promise<Record<string, number> | null> {
    const v = await this.client.get('fx:rates');
    return v ? JSON.parse(v) : null;
  }

  async publishLiveCandle(marketId: number, candle: object): Promise<void> {
    await this.publisher.publish(`live:candle:${marketId}`, JSON.stringify(candle));
  }

  createSubscriber(): Redis {
    return new Redis(buildOpts());
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    await this.client.setex(key, ttl, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
  }
}
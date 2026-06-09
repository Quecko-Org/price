// ============================================================
// redis-cache.service.ts
//
// WHY Redis:
//   PriceCacheService is currently a plain in-memory Map.
//   That means:
//   - If you run 2 instances (PM2 cluster, K8s pods), each has its
//     own Map → prices diverge → API returns inconsistent data.
//   - On restart, price cache is cold for ~1 minute.
//   - API reads hit TimescaleDB even for latest price (heavy query).
//
// Redis fixes all three:
//   - Shared across all instances (single source of truth)
//   - Survives restarts (persisted via AOF)
//   - API reads latest price in ~0.2ms (no DB query)
//
// KEY SCHEMA:
//   price:{symbol}           → latest USD price  (string, TTL 2min)
//   candle:latest:{marketId} → latest aggregated candle (JSON, TTL 2min)
//   fx:rates                 → fiat rate map (JSON, TTL 10min)
//   stats24h:{marketId}      → 24h stats (JSON, TTL 1min)
//
// PUB/SUB CHANNEL:
//   live:candle:{marketId}   → published on every minute close
//   (WebSocket gateway subscribes and pushes to connected clients)
// ============================================================
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

const TTL = {
  PRICE: 120,  // 2 min — refreshed on every candle close
  CANDLE: 120,  // 2 min
  FX: 600,  // 10 min
  STATS: 60,   // 1 min
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private publisher: Redis; // separate connection for PUBLISH (ioredis rule)
  private subscriber: Redis;

  constructor() {
    const opts = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6378),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times: number) => Math.min(times * 200, 3_000),
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    };

    this.client = new Redis(opts);
    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.client.on('error', e => this.logger.error('Redis client error', e));
    this.publisher.on('error', e => this.logger.error('Redis publisher error', e));
    this.subscriber.on('error', e => this.logger.error('Redis subscriber error', e));

    this.logger.log('✅ Redis connected');


  }


  // ── PRICE ─────────────────────────────────────────────────
  async setPrice(symbol: string, priceUsd: number) {
    await this.client.setex(`price:${symbol}`, TTL.PRICE, priceUsd.toString());
  }

  async getPrice(symbol: string): Promise<number | null> {
    const v = await this.client.get(`price:${symbol}`);
    return v ? Number(v) : null;
  }

  async getAllPrices(): Promise<Map<string, number>> {
    let result
    try {
    const keys = await this.client.keys('price:*');
      if (!keys.length) return new Map();

      const values = await this.client.mget(...keys);

      result = new Map<string, number>();

      keys.forEach((k, i) => {
        const symbol = k.replace('price:', '');
        const val = values[i];
        if (val) result.set(symbol, Number(val));
      });
    } catch (er) {
      console.log("sdds", er)
    }
    return result;

  }

  // ── LATEST CANDLE ─────────────────────────────────────────
  async setLatestCandle(marketId: number, candle: object) {
    await this.client.setex(
      `candle:latest:${marketId}`,
      TTL.CANDLE,
      JSON.stringify(candle)
    );
  }

  async getLatestCandle(marketId: number): Promise<object | null> {
    const v = await this.client.get(`candle:latest:${marketId}`);
    return v ? JSON.parse(v) : null;
  }

  // ── 24H STATS ─────────────────────────────────────────────
  async set24hStats(marketId: number, stats: object) {
    await this.client.setex(
      `stats24h:${marketId}`,
      TTL.STATS,
      JSON.stringify(stats)
    );
  }

  async get24hStats(marketId: number): Promise<object | null> {
    const v = await this.client.get(`stats24h:${marketId}`);
    return v ? JSON.parse(v) : null;
  }

  // ── FX RATES ──────────────────────────────────────────────
  async setFxRates(rates: Record<string, number>) {
    await this.client.setex('fx:rates', TTL.FX, JSON.stringify(rates));
  }

  async getFxRates(): Promise<Record<string, number> | null> {
    const v = await this.client.get('fx:rates');
    return v ? JSON.parse(v) : null;
  }

  // ── PUB/SUB — live candle broadcast ───────────────────────
  // Published after every minute close so WebSocket gateway
  // can push updates to subscribed clients without polling DB.
  async publishLiveCandle(marketId: number, candle: object) {
    await this.publisher.publish(
      `live:candle:${marketId}`,
      JSON.stringify(candle)
    );
  }


  // Returns a subscriber connection — caller owns disconnect
  createSubscriber(): Redis {
    return new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6378),
      password: process.env.REDIS_PASSWORD,
    });
  }

  // ── GENERIC ───────────────────────────────────────────────
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setex(key: string, ttl: number, value: string) {
    return this.client.setex(key, ttl, value);
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
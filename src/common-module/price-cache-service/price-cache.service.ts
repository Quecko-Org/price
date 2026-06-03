// ============================================================
// price-cache.service.ts
//
// STARTUP ORDER PROBLEM:
//   App boots → PriceCacheService.onModuleInit() runs
//   → tries Redis getAllPrices() → Redis client not yet connected
//   → TypeError: Cannot read properties of undefined
//
// FIX 1: Guard Redis calls — client may not be ready at onModuleInit
// FIX 2: Warm from DB if Redis is empty (CEX hasn't run yet)
// FIX 3: Export isPriceReady() so DEX services can wait
//
// STARTUP SEQUENCE:
//   1. PriceCacheService.onModuleInit()
//      → try Redis (may be empty on first boot)
//      → fallback: load from aggregated_candles_1m DB (last close per market)
//   2. CEX WebSocket connects → starts streaming candles
//   3. flushClosedMinutes() → updateCryptoPrice() → Redis.setPrice()
//   4. DEX adapters start → prices now available for normalizeToUSD()
// ============================================================
import { Injectable, OnModuleInit, Logger, ConsoleLogger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '@/aggregation/entities/candle-1m.entity';
import { RedisService } from '../redis/redis.service';
import { STABLES } from '@/ingestion/onchain/common/common-tokens';

const STABLE = new Set(STABLES);

@Injectable()
export class PriceCacheService implements OnModuleInit {
  private readonly logger = new Logger(PriceCacheService.name);

  // L1 in-memory (instant reads, process-local)
  private cryptoRates = new Map<string, number>();
  private fiatRates   = new Map<string, number>();

  // Flag: true once at least some prices are loaded
  private pricesLoaded = false;

  constructor(
    private readonly redis:RedisService,
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
  ) {}

  async onModuleInit() {
    // Step 1: Try Redis (may fail if Redis not ready or empty)
    let redisLoaded = 0;
    try {
      const prices = await this.redis.getAllPrices();
      if (prices && prices.size > 0) {
        for (const [symbol, price] of prices) {
          this.cryptoRates.set(symbol, price);
          redisLoaded++;
        }
        this.logger.log(`✅ Price cache warmed from Redis: ${redisLoaded} symbols`);
      }

    } catch (err: any) {
      this.logger.warn(`Redis price warm failed (${err?.message}) — falling back to DB`);
    }
    // Step 2: If Redis was empty, load from last candle close per market in DB
    if (redisLoaded === 0 || redisLoaded<5) {
      await this.warmFromDatabase();
    }
 
    // Step 3: Try FX rates from Redis
    try {
      const fxRates = await this.redis.getFxRates();
      if (fxRates) {
        this.updateFiatRates(fxRates);
        this.logger.log('✅ FX rates loaded from Redis');
      }
    } catch (err: any) {
      this.logger.warn(`Redis FX rates failed (${err?.message})`);
    }

    this.pricesLoaded = this.cryptoRates.size > 0;
    this.logger.log(
      `📊 Price cache ready: ${this.cryptoRates.size} crypto prices loaded` +
      (this.pricesLoaded ? '' : ' ⚠️  No prices yet — will populate from CEX streams')
    );
  }

  // ── Warm from DB: last close price per market ─────────────────
  // Used when Redis is empty (first boot or Redis restart).
  // Queries the most recent candle close per market.
  private async warmFromDatabase() {
    try {
      this.logger.log('🔄 Warming price cache from DB candles...');

      // Get latest close price per marketId using a subquery
      const rows = await this.candleRepo
        .createQueryBuilder('c')
        .innerJoin('c.market', 'm')
        .select('m.base', 'base')
        .addSelect('c.close', 'close')
        .where(`c.openTime = (
          SELECT MAX(c2."openTime") FROM aggregated_candles_1m c2
          WHERE c2."marketId" = c."marketId"
        )`)
        .getRawMany();
console.log("roww",rows.length)
      let loaded = 0;
      for (const row of rows) {
        
        const price = Number(row.close);
        if (row.base && price > 0) {
          this.cryptoRates.set(row.base, price);
          // Also write to Redis so other instances benefit
          this.redis.setPrice(row.base, price).catch(() => {});
          loaded++;
        }
     
      }
 
      this.logger.log(`✅ Price cache warmed from DB: ${loaded} symbols`);

    } catch (err: any) {
      this.logger.warn(`DB price warm failed (${err?.message}) — prices will come from live CEX feeds`);
    }
  }

  // ── WRITES ────────────────────────────────────────────────────
  updateFiatRates(rates: Record<string, number>) {
    for (const [currency, rate] of Object.entries(rates)) {
      if (!rate || rate <= 0) continue;
      this.fiatRates.set(currency, 1 / Number(rate));
    }
  }

  updateCryptoPrice(symbol: string, priceUSD: number) {
    if (!priceUSD || priceUSD <= 0) return;
    this.cryptoRates.set(symbol, priceUSD);
    this.pricesLoaded = true;
    // Write to Redis L2 (fire and forget)
    this.redis.setPrice(symbol, priceUSD).catch(() => {});
  }

  // ── READS ─────────────────────────────────────────────────────
  getPrice(symbol: string): number | null {
    if (!symbol) return null;
    if (STABLE.has(symbol)) return 1;
    return this.cryptoRates.get(symbol) ?? null; // null = unknown (not 1!)
  }

  async getPriceAsync(symbol: string): Promise<number | null> {
    if (!symbol) return null;
    if (STABLE.has(symbol)) return 1;

    // L1 hit
    const l1 = this.cryptoRates.get(symbol);
    if (l1 != null) return l1;

    // L2 Redis fallback
    try {
      const l2 = await this.redis.getPrice(symbol);
      if (l2 != null) {
        this.cryptoRates.set(symbol, l2);
        return l2;
      }
    } catch (_) {}

    return null;
  }

  convertToUSD(price: number, quote: string): number | null {
    if (!price || price <= 0) return null;
    if (quote === 'USD') return price;
    if (STABLE.has(quote)) return price;

    const fiat = this.fiatRates.get(quote);
    if (fiat) return price * fiat;

    const crypto = this.cryptoRates.get(quote);
    if (crypto) return price * crypto;

    return null;
  }

  hasPrice(symbol: string): boolean {
    return STABLE.has(symbol) || this.cryptoRates.has(symbol);
  }

  /**
   * Returns true if at least some prices are loaded.
   * DEX services should check this before starting — if false,
   * normalizeToUSD will return null for everything.
   *
   * Called by OnchainService to decide whether to wait.
   */
  isPriceReady(): boolean {
    return this.pricesLoaded;
  }

  /**
   * Wait until prices are loaded (with timeout).
   * Called by OnchainService.onModuleInit() before starting DEX.
   */
  async waitForPrices(timeoutMs = 30_000): Promise<void> {
    if (this.pricesLoaded) return;

    this.logger.log('⏳ Waiting for price cache to populate...');

    return new Promise((resolve) => {
      const start    = Date.now();
      const interval = setInterval(() => {
        if (this.pricesLoaded || Date.now() - start > timeoutMs) {
          clearInterval(interval);
          if (!this.pricesLoaded) {
            this.logger.warn(
              '⚠️  Price cache still empty after timeout — DEX starting anyway. ' +
              'Prices will populate from CEX streams.'
            );
          } else {
            this.logger.log('✅ Price cache ready — starting DEX');
          }
          resolve();
        }
      }, 1_000);
    });
  }
}
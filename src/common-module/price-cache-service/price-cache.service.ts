// ============================================================
// price-cache.service.ts
//
// Now backed by Redis instead of a plain in-memory Map.
// In-memory Map still used as L1 cache (sub-millisecond reads)
// Redis used as L2 (shared across instances, survives restarts).
//
// Update flow:
//   aggregation.consumer flushClosedMinutes()
//     → this.updateCryptoPrice(symbol, price)   ← updates L1
//     → redis.setPrice(symbol, price)            ← updates L2
//
// Read flow (API /price endpoint):
//   getPrice(symbol)
//     → L1 hit → return immediately (0.001ms)
//     → L1 miss → redis.getPrice() → update L1 → return (0.2ms)
//     → Redis miss → return null (cold start, price not yet set)
// ============================================================
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { STABLES } from '@/ingestion/onchain/common/common-tokens';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PriceCacheService implements OnModuleInit {
  private readonly logger = new Logger(PriceCacheService.name);

  // L1 in-memory (process-local, instant reads)
  private cryptoRates = new Map<string, number>();
  private fiatRates   = new Map<string, number>();

  private static STABLES = new Set(STABLES);

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    // Warm L1 from Redis on startup — avoids cold-start price gaps
    try {
      const prices = await this.redis.getAllPrices();
      for (const [symbol, price] of prices) {
        this.cryptoRates.set(symbol, price);
      }
      this.logger.log(`✅ Price cache warmed: ${prices.size} symbols from Redis`);

      const fxRates = await this.redis.getFxRates();
      if (fxRates) {
        this.updateFiatRates(fxRates);
        this.logger.log('✅ FX rates loaded from Redis');
      }
    } catch (err) {
      this.logger.warn('Redis unavailable at startup — price cache cold', err);
    }
  }

  // ── WRITES ────────────────────────────────────────────────
  updateFiatRates(rates: Record<string, number>) {
    for (const [currency, rate] of Object.entries(rates)) {
      if (!rate || rate <= 0) continue;
      this.fiatRates.set(currency, 1 / Number(rate)); // invert to USD
    }
  }

  updateCryptoPrice(symbol: string, priceUSD: number) {
    if (!priceUSD || priceUSD <= 0) return;
    this.cryptoRates.set(symbol, priceUSD); // L1
    // L2 write happens in aggregation.consumer (fire-and-forget)
  }

  // ── READS ─────────────────────────────────────────────────
  convertToUSD(price: number, quote: string): number | null {
    if (!price || price <= 0) return null;
    if (quote === 'USD') return price;
    if (PriceCacheService.STABLES.has(quote)) return price;

    const fiat = this.fiatRates.get(quote);
    if (fiat) return price * fiat;

    const crypto = this.cryptoRates.get(quote);
    if (crypto) return price * crypto;

    return null;
  }

  getPrice(symbol: string): number | null {
    if (!symbol) return null;
    if (PriceCacheService.STABLES.has(symbol)) return 1;
    return this.cryptoRates.get(symbol) ?? null; // ✅ null not 1 (no silent wrong prices)
  }

  // Async version — falls back to Redis on L1 miss
  async getPriceAsync(symbol: string): Promise<number | null> {
    if (!symbol) return null;
    if (PriceCacheService.STABLES.has(symbol)) return 1;

    const l1 = this.cryptoRates.get(symbol);
    if (l1 != null) return l1;

    // L1 miss — check Redis (another instance may have set it)
    const l2 = await this.redis.getPrice(symbol);
    if (l2 != null) {
      this.cryptoRates.set(symbol, l2); // populate L1
      return l2;
    }

    return null;
  }

  hasPrice(symbol: string): boolean {
    return PriceCacheService.STABLES.has(symbol) || this.cryptoRates.has(symbol);
  }
}
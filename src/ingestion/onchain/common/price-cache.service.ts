// src/ingestion/onchain/common/price-cache.service.ts
//
// Holds the latest USD prices for bridge assets (ETH, BTC).
// These are fed FROM the CEX aggregation layer (AggregationService → handleLiveCandle)
// so DEX price normalization always has a fresh ETH/BTC reference.
//
// Usage:
//   Inject PriceCacheService into AggregationService and call
//   priceCache.setPrice('ETH', usdClose) whenever a live CEX candle
//   arrives for an ETH market.

import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_MAX_AGE_MS = 60_000 * 3; // 1 minute — stale after this

@Injectable()
export class PriceCacheServices {
  private readonly logger = new Logger(PriceCacheServices.name); 

  // symbol → latest USD price
  private prices = new Map<string, number>();

  // symbol → timestamp of last update
  private updatedAt = new Map<string, number>();

  /**
   * Set/update a price.  Call this from AggregationService when a CEX
   * candle for the base token arrives (e.g. ETH-USD, BTC-USD).
   */
  setPrice(symbol: string, price: number): void {
    if (price <= 0) return;
    const upper = symbol.toUpperCase();
    this.prices.set(upper, price);
    this.updatedAt.set(upper, Date.now());
  }

  /**
   * Get a price with no staleness check.
   * Returns null if never set.
   */
  getPrice(symbol: string): number | null {
    return this.prices.get(symbol.toUpperCase()) ?? null;
  }
 
  /**
   * Get a price, returning null if it's older than maxAgeMs.
   * Use this in the adapter to avoid using stale ETH prices during outages.
   */
  getPriceSafe(symbol: string, maxAgeMs = DEFAULT_MAX_AGE_MS): number | null {
    const upper = symbol.toUpperCase();
    const price = this.prices.get(upper);
    const ts = this.updatedAt.get(upper);

    if (!price || !ts) return null;
    if (Date.now() - ts > maxAgeMs) {
      this.logger.warn(`Price for ${upper} is stale (${Date.now() - ts}ms old)`);
      return null;
    }

    return price;
  }

  getAll(): Record<string, number> {
    return Object.fromEntries(this.prices);
  }

  /**
   * Check if we have a fresh price for a given symbol.
   */
  hasFreshPrice(symbol: string, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
    return this.getPriceSafe(symbol, maxAgeMs) !== null;
  }
}
import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
import { DexPool } from "./entities/pool.entityt";
import { canonicalSymbol } from "../adapters/uniswap/base/pool-filter";

export class OnchainUtil {

  // ============================================================
  // sqrtPriceX96 → token1 per token0
  // ============================================================
  static sqrtPriceToPrice(
    sqrt: bigint,
    decimals0: number,
    decimals1: number
  ): number |null {
    if (!sqrt || sqrt === 0n) return null;

    const ratio = Number(sqrt) / 2 ** 96;
    return (ratio * ratio) * (10 ** (decimals0 - decimals1));
  }





  // ============================================================
  // Normalize pool price → USD
  // ============================================================
  static normalizeToUSD(
    price: number,
    pool: DexPool,
    priceCache: PriceCacheService
  ): number | null {
    if (!price || price <= 0) return null;

    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);

    const p0 = priceCache.getPrice(sym0);
    const p1 = priceCache.getPrice(sym1);

    const quoteIsToken1 =
      pool.quoteTokenAddress === pool.token1.address.toLowerCase();

    if (quoteIsToken1 && p1) return price * p1;
    if (!quoteIsToken1 && p0) return (1 / price) * p0;

    return null;
  }

  // ============================================================
  // V4 fallback: price from TVL ratio
  // ⚠️ Approximation only (used at startup)
  // ============================================================
  static ratioFromBalances(pool: DexPool): number | null {
    if (pool.token0Balance <= 0 || pool.token1Balance <= 0) return null;
    return pool.token1Balance / pool.token0Balance;
  }

  // ============================================================
  // Apply price to pool (raw + USD)
  // ============================================================
  static applyPrice(
    pool: DexPool,
    price: number,
    priceCache: PriceCacheService
  ) {
    if (!price || price <= 0) return;

    pool.price = price;
    const usd = this.normalizeToUSD(price, pool, priceCache);
    console.log("applyPrice",price,usd)
//need to handle if price not exist on cex exchanges like tomi
    if (usd) {
      pool.price = usd;
    }
  }
}
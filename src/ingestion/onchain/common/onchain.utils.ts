// ============================================================
// onchain.utils.ts
//
// KEY FORMULA (memorize this):
//   sqrtPriceX96 always gives:  price = token1 / token0  (after decimal adj)
//
//   baseIsToken0=true  (base=token0):
//     1 token0 = price × token1
//     token0_usd = price × token1_usd_price          ← multiply
//
//   baseIsToken0=false (base=token1):
//     1 token1 = (1/price) × token0
//     token1_usd = (1/price) × token0_usd_price      ← divide
//
// WORKED EXAMPLES:
//
//   Pool ETH(t0)/USDC(t1), price = 3000 (3000 USDC per 1 ETH)
//     ETH-USD  market (baseIsToken0=true):
//       ETH_usd = 3000 × USDC_price(1) = $3000 ✅
//     USDC-USD market (baseIsToken0=false):
//       USDC_usd = (1/3000) × ETH_price(3000) = $1 ✅
//
//   Pool USDC(t0)/ETH(t1), price = 0.000333 (0.000333 ETH per 1 USDC)
//     USDC-USD market (baseIsToken0=true):
//       USDC_usd = 0.000333 × ETH_price(3000) = $1 ✅
//     ETH-USD  market (baseIsToken0=false):
//       ETH_usd = (1/0.000333) × USDC_price(1) = $3000 ✅
//
//   Pool ETH(t0)/LINK(t1), price = 15000 (15000 LINK per 1 ETH, LINK=$3, ETH=$45000)
//     ETH-USD  market (baseIsToken0=true):
//       ETH_usd = 15000 × LINK_price(3) = $45000 ✅
//     LINK-USD market (baseIsToken0=false):
//       LINK_usd = (1/15000) × ETH_price(45000) = $3 ✅
//
//   Pool LINK(t0)/USDC(t1), price = 0.000067 (USDC per LINK, 1 LINK = 0.000067 USDC? No...)
//   Wait: LINK addr < USDC addr so LINK=t0, USDC=t1
//   price = USDC per LINK = 3 (3 USDC = 1 LINK)
//     LINK-USD market (baseIsToken0=true):
//       LINK_usd = 3 × USDC_price(1) = $3 ✅
//     USDC-USD market (baseIsToken0=false):
//       USDC_usd = (1/3) × LINK_price(3) = $1 ✅
// ============================================================
import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
import { DexPool } from "./entities/pool.entityt";
import { canonicalSymbol } from "../adapters/uniswap/base/pool-filter";

export class OnchainUtil {

  // ============================================================
  // sqrtPriceX96 → token1/token0 ratio (human-readable, decimal-adjusted)
  // ============================================================
  static sqrtPriceToPrice(
    sqrt:      bigint,
    decimals0: number,
    decimals1: number,
  ): number | null {
    if (!sqrt || sqrt === 0n) return null;

    const Q96   = 2n ** 96n;
    const SCALE = 10n ** 18n;

    // Integer bigint math to avoid float precision loss
    const sqrtScaled   = (sqrt * SCALE) / Q96;
    const ratioSq      = (sqrtScaled * sqrtScaled) / SCALE;
    const ratioSqFloat = Number(ratioSq) / 1e18;

    // Adjust for token decimal difference
    const decimalAdj = 10 ** (decimals0 - decimals1);
    const price      = ratioSqFloat * decimalAdj;

    if (!isFinite(price) || price <= 0) return null;
    return price;
  }

  // ============================================================
  // Convert price ratio → USD for a SPECIFIC market
  //
  // baseIsToken0 comes from dex_market_maps row — set once at mapping time.
  // Caller (adapter) reads it from the mapping and passes it here.
  //
  // price = token1/token0 ratio (from sqrtPriceToPrice)
  //
  // baseIsToken0=true  → base=token0: USD = price × token1_usd
  // baseIsToken0=false → base=token1: USD = (1/price) × token0_usd
  // ============================================================
  static normalizeToUSD(
    price:        number,
    pool:         DexPool,
    priceCache:   PriceCacheService,
    baseIsToken0: boolean,
  ): number | null {
    if (!price || price <= 0) return null;

    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);
    const p0   = priceCache.getPrice(sym0); // null if unknown to CEX
    const p1   = priceCache.getPrice(sym1);

    if (baseIsToken0) {
      // Base = token0, quote = token1
      // token0_usd = price × token1_usd
      if (p1 != null) return price * p1;
      // If token1 price unknown but token0 IS known (stable), return it directly
      if (p0 != null) return p0;
    } else {
      // Base = token1, quote = token0
      // token1_usd = (1/price) × token0_usd
      if (p0 != null) return (1 / price) * p0;
      // If token0 price unknown but token1 IS known (stable), return it directly
      if (p1 != null) return p1;
    }

    return null;
  }

  // ============================================================
  // normalizeToUSD without baseIsToken0 context
  // Used ONLY at startup (applyPrice / slot0 init) before we know
  // which market this pool is being queried for.
  // Tries both directions and returns first valid result.
  // ============================================================
  static normalizeToUSDAuto(
    price:      number,
    pool:       DexPool,
    priceCache: PriceCacheService,
  ): number | null {
    if (!price || price <= 0) return null;

    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);
    const p0   = priceCache.getPrice(sym0);
    const p1   = priceCache.getPrice(sym1);

    // Try token1 as quote: token0_usd = price × p1
    if (p1 != null) {
      const usd = price * p1;
      if (usd > 0 && isFinite(usd)) return usd;
    }

    // Try token0 as quote: token1_usd = (1/price) × p0
    if (p0 != null) {
      const usd = (1 / price) * p0;
      if (usd > 0 && isFinite(usd)) return usd;
    }

    return null;
  }

  // ============================================================
  // Apply startup price to pool.price (init only, no market context)
  // ============================================================
  static applyPrice(
    pool:       DexPool,
    price:      number,
    priceCache: PriceCacheService,
  ) {
    if (!price || price <= 0) return;
    const usd = this.normalizeToUSDAuto(price, pool, priceCache);
    if (usd != null && usd > 0 && isFinite(usd)) {
      pool.price = usd;
    }
  }

  // ============================================================
  // USD liquidity from token balances
  // ============================================================
  static computeLiquidityUsd(
    pool:       DexPool,
    priceCache: PriceCacheService,
  ): boolean {
    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);
    const p0   = priceCache.getPrice(sym0);
    const p1   = priceCache.getPrice(sym1);

    if (p0 == null && p1 == null) return false;

    pool.liquidityUsd =
      (p0 != null ? pool.token0Balance * p0 : 0) +
      (p1 != null ? pool.token1Balance * p1 : 0);

    return true;
  }

  // ============================================================
  // isActive: centralized rule used everywhere
  // ============================================================
  static isActivePool(pool: DexPool): boolean {
    return (
      pool.liquidityUsd > 1000 &&
      pool.liquidityUsd < 100_000_000_000 &&
      pool.token0Balance > 0 &&
      pool.token1Balance > 0
    );
  }

  // ============================================================
  // Rough price from balance ratio (V4 fallback at startup)
  // ============================================================
  static ratioFromBalances(pool: DexPool): number | null {
    if (pool.token0Balance <= 0 || pool.token1Balance <= 0) return null;
    return pool.token1Balance / pool.token0Balance;
  }
}
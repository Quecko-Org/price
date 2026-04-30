import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
import { DexPool } from "./entities/pool.entityt";
import { canonicalSymbol } from "../adapters/uniswap/base/pool-filter";
import Decimal from "decimal.js";
const Q96 = new Decimal(2).pow(96);

export class OnchainUtil {

  // ============================================================
  // sqrtPriceX96 → token1 per token0
  // ============================================================
  static sqrtPriceToPrice(
    sqrt: bigint,
    decimals0: number,
    decimals1: number
  ): number |null {
    // console.log("sqrtPriceToPrice",sqrt,decimals0,decimals1)
   
    if (!sqrt || sqrt === 0n) return null;

   
    const Q96 = 2n ** 96n;
 
    // Scale factor for precision: work in units of 1e18
    const SCALE = 10n ** 18n;
 
    // (sqrt * SCALE / Q96)^2 / SCALE  →  ratio^2 * SCALE
    const sqrtScaled = (sqrt * SCALE) / Q96;         // sqrt/Q96 × 1e18
    const ratioSq    = (sqrtScaled * sqrtScaled) / SCALE; // ratio² × 1e18
 
    // Now ratioSq is ratio² × 1e18 as bigint
    // Convert to float: divide by 1e18
    const ratioSqFloat = Number(ratioSq) / 1e18;
 
    // Adjust for token decimal difference
    const decimalAdj = 10 ** (decimals0 - decimals1);
    const price = ratioSqFloat * decimalAdj;
 
    if (!isFinite(price) || price <= 0) return null;
    return price;
  

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
    // getPrice returns null for unknown, 1 for stables
   
 

    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);

 const p0 = priceCache.getPrice(sym0);
    const p1 = priceCache.getPrice(sym1);
    const quoteIsToken1 =
    pool.quoteTokenAddress === pool.token1.address.toLowerCase();
 
  // if (quoteIsToken1) {
    // BASE/QUOTE pool — quote is token1
    if (p1 != null){ return price * p1;

    // Quote not in CEX feed but might be derivable from token0
    // e.g. base is USDC (p0=1), token1 is unknown → can't derive
    // return null;
  } else {
    // QUOTE/BASE pool — quote is token0
    if (p0 != null) return (1 / price) * p0;

  // }
  
// //19601.12340393414
//     const quoteIsToken1 =
//       pool.quoteTokenAddress === pool.token1.address.toLowerCase();
// console.log("normalizeToUSD",price,pool,sym0,sym1,p0,p1,quoteIsToken1)
//     if (quoteIsToken1 && p1) return price * p1;
//     if (!quoteIsToken1 && p0) return (1 / price) * p0;

  }    return null;}

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
    // console.log("applyPrice1",pool.id,price)

    const usd = this.normalizeToUSD(price, pool, priceCache);
 
//need to handle if price not exist on cex exchanges like tomi
if (usd != null && usd > 0 && isFinite(usd)) {
  pool.price = usd;
}
  }




  static computeLiquidityUsd(
    pool:       DexPool,
    priceCache: PriceCacheService,
  ): boolean {
    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);
  
    const p0 = priceCache.getPrice(sym0);
    const p1 = priceCache.getPrice(sym1);
 
    if (p0 == null && p1 == null) return false;
 

    const val0 = p0 != null ? pool.token0Balance * p0 : 0;
    const val1 = p1 != null ? pool.token1Balance * p1 : 0;
    pool.liquidityUsd = val0 + val1;
    return true;
  }
 
  // ============================================================
  // isActive decision — centralized so every caller uses same rule
  //
  // A pool is active if:
  //   1. liquidityUsd > $1000 (enough to produce reliable prices)
  //   2. Both token balances > 0 (not a dead pool)
  //   3. liquidityUsd is a sane value (< $100B cap — catches corruption)
  // ============================================================
  static isActivePool(pool: DexPool): boolean {
  
    return (
    
      pool.liquidityUsd > 1000 &&
      pool.liquidityUsd < 100_000_000_000 && // 100B sanity cap
      pool.token0Balance > 0 &&
      pool.token1Balance > 0
    );
  }
} 
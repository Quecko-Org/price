// ============================================================
// dex-auto-mapper.service.ts
//
// Maps ONE pool → MULTIPLE market rows (one per token with a market)
//
// All 4 pool combination cases after address sort:
//
// Case 1: base(t0) / quote(t1)   e.g. LINK(t0)/USDC(t1)
//   → LINK-USD market: baseIsToken0=true
//   → USDC-USD market: baseIsToken0=false
//
// Case 2: quote(t0) / base(t1)   e.g. ETH(t0)/LINK(t1)
//   → ETH-USD market:  baseIsToken0=true
//   → LINK-USD market: baseIsToken0=false
//
// Case 3: quote1(t0) / quote2(t1) e.g. ETH(t0)/USDC(t1)
//   → ETH-USD market:  baseIsToken0=true
//   → USDC-USD market: baseIsToken0=false
//
// Case 4: quote2(t0) / quote1(t1) e.g. USDC(t0)/ETH(t1)
//   → USDC-USD market: baseIsToken0=true
//   → ETH-USD market:  baseIsToken0=false
//
// In ALL cases: just check if each token has a market → save row.
// No stable/quote detection needed. No direction heuristics.
//
// On swap, adapter calls:
//   OnchainUtil.normalizeToUSD(price, pool, priceCache, baseIsToken0)
// where baseIsToken0 comes from the dex_market_maps row for that market.
// ============================================================
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MarketEntity } from "@/market-data/market.entity";
import { DexPool } from "../../entities/pool.entityt";
import { DexMarketMap } from "../../entities/pool-market.entity";
import { CHAIN_CONFIGS } from "../../chain.config";

// Resolve on-chain symbol → CEX canonical symbol
// WETH → ETH, WBTC → BTC etc.
function resolveCanonical(token: { symbol: string; canonicalSymbol?: string }): string {
  if (token.canonicalSymbol) return token.canonicalSymbol;
  const ALIAS: Record<string, string> = {
    WETH: "ETH", WBTC: "BTC", WBNB: "BNB",
    WMATIC: "MATIC", POL: "MATIC", WBASE: "BASE",
  };
  return ALIAS[token.symbol] ?? token.symbol;
}

@Injectable()
export class DexAutoMapperService {
  private readonly logger = new Logger(DexAutoMapperService.name);

  constructor(
    @InjectRepository(DexPool)      private poolRepo:   Repository<DexPool>,
    @InjectRepository(MarketEntity) private marketRepo: Repository<MarketEntity>,
    @InjectRepository(DexMarketMap) private mapRepo:    Repository<DexMarketMap>,
  ) {}

  // ── Full map: all pools (cron) ────────────────────────────────
  async map() {
    const pools     = await this.poolRepo.find({ relations: ["token0", "token1"] });
    const marketMap = await this.buildMarketMap();
    let total = 0;
    for (const pool of pools) total += await this.mapPool(pool, marketMap);
    this.logger.log(`✅ map() complete: ${total} new mappings`);
  }

  // ── Map specific pools (after V4 pool creation) ───────────────
  async mapPoolsV4(pools: DexPool[]) {
    if (!pools.length) return;
    const marketMap = await this.buildMarketMap();
    let total = 0;
    for (const pool of pools) {
      if (!pool.isInitialized) continue;
      total += await this.mapPool(pool, marketMap);
    }
    if (total > 0) this.logger.log(`✅ mapPoolsV4: ${total} new mappings`);
  }

  // ── Core: map one pool to ALL matching markets ────────────────
  //
  // For each token in the pool:
  //   1. Resolve CEX canonical symbol (WETH→ETH)
  //   2. Check if a market exists for that symbol (e.g. ETH-USD)
  //   3. If yes → save dex_market_maps row with baseIsToken0 flag
  //
  // baseIsToken0=true  → this token IS token0 in the pool
  // baseIsToken0=false → this token IS token1 in the pool
  //
  // Example — pool ETH(t0)/LINK(t1):
  //   sym0=ETH  → ETH-USD market exists  → save {poolId, marketId, baseIsToken0: true}
  //   sym1=LINK → LINK-USD market exists → save {poolId, marketId, baseIsToken0: false}
  //
  // Example — pool USDC(t0)/ETH(t1):  [USDC addr < ETH addr after sort]
  //   sym0=USDC → USDC-USD market exists → save {poolId, marketId, baseIsToken0: true}
  //   sym1=ETH  → ETH-USD market exists  → save {poolId, marketId, baseIsToken0: false}
  //
  private async mapPool(
    pool:      DexPool,
    marketMap: Map<string, { id: number; base: string }>,
  ): Promise<number> {
    const sym0      = resolveCanonical(pool.token0);
    const sym1      = resolveCanonical(pool.token1);
    const chainName = CHAIN_CONFIGS[pool.chainId]?.name ?? String(pool.chainId);
    let   created   = 0;

    // token0 check
    const market0 = marketMap.get(sym0);
    if (market0) {
      if (await this.saveMapping(pool.id, market0.id, true)) {
        this.logger.log(
          `✅ Pool ${pool.id} [${chainName}] ${sym0}(t0)/${sym1}(t1) ` +
          `→ market ${market0.id} (${sym0}-USD, base=token0)`
        );
        created++;
      }
    }

    // token1 check
    const market1 = marketMap.get(sym1);
    if (market1) {
      if (await this.saveMapping(pool.id, market1.id, false)) {
        this.logger.log(
          `✅ Pool ${pool.id} [${chainName}] ${sym0}(t0)/${sym1}(t1) ` +
          `→ market ${market1.id} (${sym1}-USD, base=token1)`
        );
        created++;
      }
    }

    return created;
  }

  private async saveMapping(
    poolId:       number,
    marketId:     number,
    baseIsToken0: boolean,
  ): Promise<boolean> {
    const exists = await this.mapRepo.exists({ where: { poolId, marketId } });
    if (exists) return false;
    await this.mapRepo.save({ poolId, marketId, baseIsToken0 });
    return true;
  }

  // Market lookup: CEX symbol → { id, base }
  // Only one market per symbol (first match wins)
  private async buildMarketMap(): Promise<Map<string, { id: number; base: string }>> {
    const markets = await this.marketRepo.find();
    const map     = new Map<string, { id: number; base: string }>();
    for (const m of markets) {
      if (!map.has(m.base)) {
        map.set(m.base, { id: m.id, base: m.base });
      }
    }
    return map;
  }
}
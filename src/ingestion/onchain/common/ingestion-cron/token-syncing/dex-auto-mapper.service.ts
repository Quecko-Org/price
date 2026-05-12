// ============================================================
// dex-auto-mapper.service.ts
//
// Maps DEX pools to market IDs.
// Multichain: now uses pool.chainId to scope logic correctly.
// Also uses canonicalSymbol (ETH not WETH) for market matching
// since markets are stored by CEX symbol (ETH-USD not WETH-USD).
// ============================================================
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MarketEntity } from "@/market-data/market.entity";
import { DexPool } from "../../entities/pool.entityt";
import { DexMarketMap } from "../../entities/pool-market.entity";
import { STABLES } from "../../common-tokens";
import { CHAIN_CONFIGS } from "../../chain.config";

// Resolve on-chain symbol → canonical CEX symbol
// WETH → ETH, WBTC → BTC, WBNB → BNB etc.
// Falls back to canonicalSymbol on the token entity if set.
function resolveCanonical(token: { symbol: string; canonicalSymbol?: string }): string {
  if (token.canonicalSymbol) return token.canonicalSymbol;

  const ALIAS: Record<string, string> = {
    WETH:  "ETH",
    WBTC:  "BTC",
    WBNB:  "BNB",
    WMATIC:"MATIC",
    POL:   "MATIC",
    WBASE: "BASE",
  };
  return ALIAS[token.symbol] ?? token.symbol;
}

// Check if a token symbol is a stable — works for both chain-specific
// stables (BUSD on BSC) and standard ones
function isStable(symbol: string): boolean {
  const ALL_STABLES = new Set([
    ...STABLES,
    "BUSD", "FDUSD", "USDB", "USDBC", "USDbC", // BSC/Base specific
  ]);
  return ALL_STABLES.has(symbol);
}

@Injectable()
export class DexAutoMapperService {
  private readonly logger = new Logger(DexAutoMapperService.name);

  constructor(
    @InjectRepository(DexPool)     private poolRepo:   Repository<DexPool>,
    @InjectRepository(MarketEntity) private marketRepo: Repository<MarketEntity>,
    @InjectRepository(DexMarketMap) private mapRepo:    Repository<DexMarketMap>,
  ) {}

  // ── Full map: all pools in DB (called by cron) ─────────────
  async map() {
    const pools = await this.poolRepo.find({
      relations: ["token0", "token1"],
    });

    const markets    = await this.marketRepo.find();
    const marketMap  = this.buildMarketMap(markets);

    let mapped = 0;
    for (const pool of pools) {
      if (await this.mapPool(pool, marketMap)) mapped++;
    }

    this.logger.log(`✅ map() complete: ${mapped} new mappings`);
  }

  // ── Map specific pools (called after V4 pool creation) ──────
  async mapPoolsV4(pools: DexPool[]) {
    if (!pools.length) return;

    const markets   = await this.marketRepo.find();
    const marketMap = this.buildMarketMap(markets);

    let mapped = 0;
    for (const pool of pools) {
      if (!pool.isInitialized) continue; // V4: skip unready pools
      if (await this.mapPool(pool, marketMap)) mapped++;
    }

    if (mapped > 0) this.logger.log(`✅ mapPoolsV4: ${mapped} new mappings`);
  }

  // ── Core mapping logic for a single pool ───────────────────
  private async mapPool(pool: DexPool, marketMap: Map<string, number>): Promise<boolean> {
    // Resolve canonical (CEX) symbols for both sides
    const sym0 = resolveCanonical(pool.token0);
    const sym1 = resolveCanonical(pool.token1);

    let base:  string | null = null;
    let quote: string | null = null;

    if (isStable(pool.token0.symbol) || isStable(sym0)) {
      // token0 is stable → token1 is base
      base  = sym1;
      quote = sym0;
    } else if (isStable(pool.token1.symbol) || isStable(sym1)) {
      // token1 is stable → token0 is base
      base  = sym0;
      quote = sym1;
    } else if (pool.quoteTokenAddress) {
      // No stable side — use quoteTokenAddress to determine direction
      const quoteIsToken1 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();
      base  = quoteIsToken1 ? sym0 : sym1;
      quote = quoteIsToken1 ? sym1 : sym0;
    } else {
      // Cannot determine base/quote — skip
      return false;
    }

    // Try market lookups in priority order
    const marketId =
      marketMap.get(`${base}-USD`)   ||   // ETH-USD (most common)
      marketMap.get(`${base}-USDT`)  ||   // ETH-USDT
      marketMap.get(`${base}-${quote}`);   // ETH-BNB cross pairs

    if (!marketId) return false;

    const exists = await this.mapRepo.exists({
      where: { poolId: pool.id, marketId },
    });

    if (exists) return false;

    await this.mapRepo.save({ poolId: pool.id, marketId });

    this.logger.log(
      `✅ Mapped pool ${pool.id} [${CHAIN_CONFIGS[pool.chainId]?.name ?? pool.chainId}] ` +
      `${base}/${quote} → market ${marketId}`
    );

    return true;
  }

  // ── Build lookup map from markets ───────────────────────────
  private buildMarketMap(markets: MarketEntity[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const m of markets) {
      map.set(`${m.base}-USD`,      m.id);
      map.set(`${m.base}-USDT`,     m.id);
      map.set(`${m.base}-USDC`,     m.id);
      map.set(`${m.base}-${m.quote}`, m.id);
    }
    return map;
  }
}
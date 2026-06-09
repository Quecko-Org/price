
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketEntity } from '@/market-data/market.entity';
import { DexPool } from '../../entities/pool.entityt';
import { DexMarketMap } from '../../entities/pool-market.entity';
import { CHAIN_CONFIGS } from '../../chain.config';

// Resolve on-chain symbol → CEX canonical symbol
// WETH → ETH, WBTC → BTC etc.
function resolveCanonical(token: { symbol: string; canonicalSymbol?: string }): string {
  if (token.canonicalSymbol) return token.canonicalSymbol;
  const ALIAS: Record<string, string> = {
    WETH:   'ETH',
    WBTC:   'BTC',
    WBNB:   'BNB',
    WMATIC: 'MATIC',
    POL:    'MATIC',
    WBASE:  'BASE',
  };
  return ALIAS[token.symbol] ?? token.symbol;
}

@Injectable()
export class DexAutoMapperService {
  private readonly logger = new Logger(DexAutoMapperService.name);

  constructor(
    @InjectRepository(DexPool)      private readonly poolRepo:   Repository<DexPool>,
    @InjectRepository(MarketEntity) private readonly marketRepo: Repository<MarketEntity>,
    @InjectRepository(DexMarketMap) private readonly mapRepo:    Repository<DexMarketMap>,
  ) {}

  // ── Full map: all active pools ────────────────────────────────
  // Returns number of new mappings created.
  async map(): Promise<number> {
    // Load only active + initialized pools — uninitialized pools have no price
    const pools = await this.poolRepo.find({
      where:     { isActive: true, isInitialized: true },
      relations: ['token0', 'token1'],
      select: {
        id: true, chainId: true,
        token0: { id: true, symbol: true, canonicalSymbol: true },
        token1: { id: true, symbol: true, canonicalSymbol: true },
      },
    });

    if (!pools.length) {
      this.logger.debug('map(): no active pools to process');
      return 0;
    }

    // Build market lookup map once
    const marketMap = await this.buildMarketMap();

    // Preload ALL existing mappings — avoids N+1 exists() queries
    const existingMappings = await this.mapRepo.find({
      select: ['poolId', 'marketId'],
    });
    const existingSet = new Set(
      existingMappings.map(m => `${m.poolId}:${m.marketId}`)
    );

    // Collect all new mappings to insert
    const toInsert: Partial<DexMarketMap>[] = [];

    for (const pool of pools) {
      if (!pool.token0 || !pool.token1) continue;

      const sym0 = resolveCanonical(pool.token0);
      const sym1 = resolveCanonical(pool.token1);

      // Check token0 → market
      const market0 = marketMap.get(sym0);
      if (market0) {
        const key = `${pool.id}:${market0.id}`;
        if (!existingSet.has(key)) {
          toInsert.push({ poolId: pool.id, marketId: market0.id, baseIsToken0: true });
          existingSet.add(key); // prevent duplicate in same batch
        }
      }

      // Check token1 → market
      const market1 = marketMap.get(sym1);
      if (market1 && market1.id !== market0?.id) {
        const key = `${pool.id}:${market1.id}`;
        if (!existingSet.has(key)) {
          toInsert.push({ poolId: pool.id, marketId: market1.id, baseIsToken0: false });
          existingSet.add(key);
        }
      }
    }

    if (!toInsert.length) return 0;

    // Batch insert — single query for all new mappings
    await this.mapRepo
      .createQueryBuilder()
      .insert()
      .into(DexMarketMap)
      .values(toInsert)
      .orIgnore() // skip duplicates gracefully
      .execute();

    // Log new mappings for visibility
    this.logger.log(`✅ map(): ${toInsert.length} new pool→market mappings created`);
    for (const m of toInsert.slice(0, 10)) { // log first 10 to avoid spam
      const pool   = pools.find(p => p.id === m.poolId);
      const market = [...marketMap.values()].find(v => v.id === m.marketId);
      if (pool && market) {
        const sym0 = resolveCanonical(pool.token0);
        const sym1 = resolveCanonical(pool.token1);
        const chain = CHAIN_CONFIGS[pool.chainId]?.name ?? pool.chainId;
        this.logger.debug(
          `  Pool ${m.poolId} [${chain}] ${sym0}/${sym1} ` +
          `→ ${market.base}-USD (base=token${m.baseIsToken0 ? '0' : '1'})`
        );
      }
    }
    if (toInsert.length > 10) {
      this.logger.debug(`  … and ${toInsert.length - 10} more`);
    }

    return toInsert.length;
  }

  // ── Map specific pools (called after V4 pool creation) ────────
  async mapPoolsV4(pools: DexPool[]): Promise<void> {
    if (!pools.length) return;

    const activePools = pools.filter(p => p.isInitialized);
    if (!activePools.length) return;

    const marketMap = await this.buildMarketMap();

    const existingMappings = await this.mapRepo.find({
      where:  activePools.map(p => ({ poolId: p.id })),
      select: ['poolId', 'marketId'],
    });
    const existingSet = new Set(existingMappings.map(m => `${m.poolId}:${m.marketId}`));

    const toInsert: Partial<DexMarketMap>[] = [];

    for (const pool of activePools) {
      if (!pool.token0 || !pool.token1) continue;

      const sym0 = resolveCanonical(pool.token0);
      const sym1 = resolveCanonical(pool.token1);

      const market0 = marketMap.get(sym0);
      if (market0) {
        const key = `${pool.id}:${market0.id}`;
        if (!existingSet.has(key)) {
          toInsert.push({ poolId: pool.id, marketId: market0.id, baseIsToken0: true });
          existingSet.add(key);
        }
      }

      const market1 = marketMap.get(sym1);
      if (market1 && market1.id !== market0?.id) {
        const key = `${pool.id}:${market1.id}`;
        if (!existingSet.has(key)) {
          toInsert.push({ poolId: pool.id, marketId: market1.id, baseIsToken0: false });
          existingSet.add(key);
        }
      }
    }

    if (toInsert.length) {
      await this.mapRepo
        .createQueryBuilder()
        .insert()
        .into(DexMarketMap)
        .values(toInsert)
        .orIgnore()
        .execute();

      this.logger.log(`✅ mapPoolsV4: ${toInsert.length} new mappings`);
    }
  }

  // ── Build market lookup: CEX base symbol → { id, base } ──────
  // Only one entry per base symbol — first wins.
  // Called once per map() invocation.
  private async buildMarketMap(): Promise<Map<string, { id: number; base: string }>> {
    const markets = await this.marketRepo.find({ select: ['id', 'base'] });
    const map     = new Map<string, { id: number; base: string }>();
    for (const m of markets) {
      if (!map.has(m.base)) map.set(m.base, { id: m.id, base: m.base });
    }
    return map;
  }
}

// ============================================================
// uniswap-v4-onchain.service.ts
//
// Startup sequence:
//   1. startListening()        attach live pool creation listener
//   2. loadAndStartPools()     subgraph TVL init + start adapter
//   3. runBackfillThenReload() historical scan in background
//
// TVL data sources per phase:
//   Init:          subgraph totalValueLockedToken0/1  (exact)
//   Per swap:      event amount0/amount1 delta        (exact, real-time)
//   Per modLiq:    subgraph re-sync after 60s         (exact, delayed)
// ============================================================
import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UniswapV4Adapter } from './uniswap-v4.adapter';
import { UniswapV4DiscoveryService } from './uniswapv4-pool-scanner';
import { DexType } from '@/ingestion/onchain/common/chain.enum';

@Injectable()
export class UniswapV4OnchainService implements OnModuleInit {

  private logger = new Logger(UniswapV4OnchainService.name);

  constructor(
    @InjectRepository(DexPool)      private poolRepo: Repository<DexPool>,
    @InjectRepository(DexMarketMap) private mapRepo:  Repository<DexMarketMap>,
    private readonly adapter:   UniswapV4Adapter,
    private readonly discovery: UniswapV4DiscoveryService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 V4 engine starting...');

    // 1️⃣  Live pool creation listener — MUST be first
    //     Ensures no Initialize events are missed during backfill
    await this.discovery.init();

    // 2️⃣  Load existing DB pools → subgraph TVL init → start adapter
    await this.loadAndStartPools();

    // 3️⃣  Historical backfill — runs in background, non-blocking
    this.runBackfillThenReload().catch(err =>
      this.logger.error('Backfill failed', err)
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Load known pools from DB → fetch TVL from subgraph → register
  // ─────────────────────────────────────────────────────────────
  private async loadAndStartPools() {
    const pools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4 },
      relations: ['token0', 'token1'],
    });

    this.logger.log(`📦 ${pools.length} V4 pools in DB`);

    if (!pools.length) {
      this.logger.log('ℹ️  No V4 pools yet — backfill will discover them');
      this.adapter.start();
      return;
    }

    // Fetch exact per-pool TVL from subgraph (not balanceOf PoolManager)
    await this.adapter.initializePools(pools);

    // Filter: active = has real balance + meets USD liquidity threshold
    // Include pools where priceCache not loaded yet (token0Balance > 0)
    const topPools = pools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 200);

    this.logger.log(`🔥 ${topPools.length} active V4 pools selected`);

    await this.registerPools(topPools);

    this.adapter.start();

    this.logger.log(`✅ V4 adapter live`);
  }

  // ─────────────────────────────────────────────────────────────
  // Background backfill → register newly discovered pools
  // ─────────────────────────────────────────────────────────────
  private async runBackfillThenReload() {
    this.logger.log('🔄 V4 backfill starting...');

    await this.discovery.backfill(21688329); // V4 mainnet deployment block

    this.logger.log('✅ Backfill complete — loading new pools...');

    await this.reloadNewPools();
  }

  private async reloadNewPools() {
    const allPools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4 },
      relations: ['token0', 'token1'],
    });

    // Only process pools not yet registered in the adapter
    const newPools = allPools.filter(p => !this.adapter.isRegistered(p.poolKey));

    if (!newPools.length) {
      this.logger.log('ℹ️  No new pools from backfill');
      return;
    }

    this.logger.log(`📥 ${newPools.length} new pools from backfill`);

    // Subgraph TVL init for new pools only
    await this.adapter.initializePools(newPools);

    const topNew = newPools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 100);

    if (!topNew.length) {
      this.logger.log('ℹ️  No qualifying new pools after backfill init');
      return;
    }

    // Adapter already started — register adds to existing poolMap
    await this.registerPools(topNew);

    this.logger.log(`✅ ${topNew.length} new pools registered after backfill`);
  }

  // ─────────────────────────────────────────────────────────────
  // Load market mappings + register pools with adapter
  // ─────────────────────────────────────────────────────────────
  private async registerPools(pools: DexPool[]) {
    console.log("registerPools",pools.length)
    if (!pools.length) return;

    const mappings = await this.mapRepo.find({
      where:     { poolId: In(pools.map(p => p.id)) },
      relations: ['market'],
    });
console.log("mappings",mappings.length)
    const mapByPool = new Map<number, number[]>();
    for (const m of mappings) {
      if (!m.market) continue;
      if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
      mapByPool.get(m.poolId)!.push(m.marketId);
    }

    let registered = 0;
    for (const pool of pools) {
      const markets = mapByPool.get(pool.id);
      if (!markets?.length) continue;
      this.adapter.register(pool, markets);
      registered++;
    }
    console.log("registered",registered)

    this.logger.log(`📌 ${registered}/${pools.length} pools registered with market mappings`);
  }
}






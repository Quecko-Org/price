// ============================================================
// uniswap-v4.onchain.service.ts
//
// Manages V4 lifecycle for ANY chain.
// Called by OnchainService.bootChain(chainId, provider).
//
// Uses your existing separate files:
//   UniswapV4DiscoveryService → Initialize event + backfill
//   UniswapV4Adapter          → Swap/ModifyLiquidity + Kafka
//
// Boot sequence per chain (ORDER MATTERS):
//   1. discovery.init(chainId)         load token map for this chain
//   2. discovery.listen(chainId, p)    attach Initialize event FIRST
//   3. loadAndStartPools(chainId, p)   init existing DB pools
//   4. backfill in background          historical scan, non-blocking
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ethers } from 'ethers';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { Chain, DexType, CHAIN_CONFIGS } from '@/ingestion/onchain/common/chain.config';
import { UniswapV4DiscoveryService } from './uniswapv4-pool-scanner';
import { UniswapV4Adapter } from './uniswap-v4.adapter';

@Injectable()
export class UniswapV4OnchainService {
  private readonly logger = new Logger(UniswapV4OnchainService.name);

  constructor(
    @InjectRepository(DexPool)      private poolRepo: Repository<DexPool>,
    @InjectRepository(DexMarketMap) private mapRepo:  Repository<DexMarketMap>,
    private readonly discovery: UniswapV4DiscoveryService,
    private readonly adapter:   UniswapV4Adapter,
  ) {}

  // ── Called by OnchainService per chain ───────────────────────
  async bootChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`🚀 ${config.name} V4 booting...`);

    // 1. Load token map for this chain
    await this.discovery.init(chainId);

    // 2. Attach Initialize event listener FIRST — no pools missed
    await this.discovery.listen(chainId, provider);

    // 3. Load existing DB pools → TVL init → register → start adapter
    await this.loadAndStartPools(chainId, provider);

    // 4. Historical backfill in background (non-blocking)
    this.runBackfill(chainId, provider).catch(err =>
      this.logger.error(`${config.name} V4 backfill failed`, err)
    );

    this.logger.log(`✅ ${config.name} V4 ready`);
  }

  // ── Load existing DB pools for one chain ─────────────────────
  private async loadAndStartPools(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];

    const pools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4, chainId },
      relations: ['token0', 'token1'],
    });

    this.logger.log(`📦 ${config.name} V4: ${pools.length} pools in DB`);

    if (!pools.length) {
      this.logger.log(`ℹ️  ${config.name} V4: no pools yet — backfill will discover them`);
      // Start adapter so it's ready when backfill registers pools
      this.adapter.start(chainId, provider);
      return;
    }

    // Subgraph TVL + StateView price init
    // Passes chainId so adapter uses the correct subgraph endpoint
    await this.adapter.initializePools(pools, chainId);

    const topPools = pools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 200);

    this.logger.log(`🔥 ${config.name} V4: ${topPools.length} active pools`);

    await this.registerPools(topPools, chainId);

    // Start singleton PoolManager listener for this chain
    this.adapter.start(chainId, provider);

    this.logger.log(`✅ ${config.name} V4 adapter live`);
  }

  // ── Background backfill → register net-new pools ─────────────
  private async runBackfill(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`🔄 ${config.name} V4 backfill starting...`);

    await this.discovery.backfill(chainId, provider);

    this.logger.log(`✅ ${config.name} V4 backfill complete — reloading...`);

    await this.reloadNewPools(chainId, provider);
  }

  // ── Register pools discovered during backfill ─────────────────
  private async reloadNewPools(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config  = CHAIN_CONFIGS[chainId];
    const allPools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4, chainId },
      relations: ['token0', 'token1'],
    });

    // Only process pools not yet in the adapter's poolMap
    const newPools = allPools.filter(p => !this.adapter.isRegistered(chainId, p.poolKey));

    if (!newPools.length) {
      this.logger.log(`ℹ️  ${config.name} V4: no new pools from backfill`);
      return;
    }

    this.logger.log(`📥 ${config.name} V4: ${newPools.length} new pools from backfill`);

    await this.adapter.initializePools(newPools, chainId);

    const topNew = newPools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 100);

    if (!topNew.length) return;

    await this.registerPools(topNew, chainId);

    this.logger.log(`✅ ${config.name} V4: ${topNew.length} new pools registered`);
  }

  // ── Load market mappings + register pools with adapter ────────
  private async registerPools(pools: DexPool[], chainId: Chain) {
    if (!pools.length) return;

    const mappings = await this.mapRepo.find({
      where:     { poolId: In(pools.map(p => p.id)) },
      relations: ['market'],
    });

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
      this.adapter.register(chainId, pool, markets);
      registered++;
    }

    this.logger.log(
      `📌 ${CHAIN_CONFIGS[chainId].name} V4: ${registered}/${pools.length} pools registered`
    );
  }
}
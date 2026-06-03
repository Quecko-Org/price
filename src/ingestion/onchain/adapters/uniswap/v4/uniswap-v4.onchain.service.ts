// ============================================================
// uniswap-v4-onchain.service.ts
//
// Loads dex_market_maps with baseIsToken0.
// Registers pool + ALL its market mappings with V4 adapter.
// One PoolManager listener handles all pools and all markets.
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
import { PoolMarketMapping } from '../base/dex-adapter.interface';

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
        console.log("v4 boot chain")

    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`🚀 ${config.name} V4 booting...`);

    await this.discovery.init(chainId);
    await this.discovery.listen(chainId, provider);
    await this.loadAndStartPools(chainId, provider);
console.log("before loadAndStartPools")

    this.runBackfill(chainId, provider).catch(err =>
      this.logger.error(`${config.name} V4 backfill failed`, err)
    );

    this.logger.log(`✅ ${config.name} V4 ready`);
  }

  // ── Load existing pools → init → register → start ────────────
  private async loadAndStartPools(chainId: Chain, provider: ethers.WebSocketProvider) {
console.log("loadAndStartPools")
    const config = CHAIN_CONFIGS[chainId];

    const pools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4, chainId },
      relations: ['token0', 'token1'],
    });
console.log("loadAndStartPools",pools.length)

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
console.log("v4 toppool",topPools.length)
    await this.registerPools(topPools, chainId);
    this.adapter.start(chainId, provider);

    this.logger.log(`✅ ${config.name} V4 adapter live`);
  }

  // ── After backfill: register newly discovered pools ───────────
  private async runBackfill(chainId: Chain, provider: ethers.WebSocketProvider) {


    // await this.discovery.backfill(chainId, provider);

    const allPools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V4, chainId },
      relations: ['token0', 'token1'],
    });

    const newPools = allPools.filter(p => !this.adapter.isRegistered(chainId, p.poolKey));
    if (!newPools.length) return;

    await this.adapter.initializePools(newPools, chainId);

    const topNew = newPools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 100);

    await this.registerPools(topNew, chainId);

    this.logger.log(
      `✅ ${CHAIN_CONFIGS[chainId].name} V4: ${topNew.length} new pools registered`
    ); 
  }
 
  // ── Load mappings + register pool with adapter ────────────────
  private async registerPools(pools: DexPool[], chainId: Chain) {
    console.log("pool register",pools.length)
    if (!pools.length) return;

    const mappings = await this.mapRepo.find({
      where:     { poolId: In(pools.map(p => p.id)) },
      relations: ['market'],
    });

    // Group: poolId → PoolMarketMapping[]
    // Each pool has multiple rows — one per token with a market
    const mapByPool = new Map<number, PoolMarketMapping[]>();
    for (const m of mappings) {
      if (!m.market) continue;
      if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
      mapByPool.get(m.poolId)!.push({
        marketId:     m.marketId,
        marketBase:   m.market.base,
        baseIsToken0: m.baseIsToken0,
      });
    }

    let registered = 0;
    for (const pool of pools) {
      const poolMappings = mapByPool.get(pool.id);
      if (!poolMappings?.length) continue; // no market mapping yet

      // Register pool with ALL its market mappings
      // ETH/USDC → registers with [ETH-USD mapping, USDC-USD mapping]
      this.adapter.register(chainId, pool, poolMappings);
      registered++;
    }

    this.logger.log(
      `📌 ${CHAIN_CONFIGS[chainId].name} V4: ${registered}/${pools.length} pools registered`
    );
  }
}
// ============================================================
// uniswap-v3-onchain.service.ts
//
// Loads dex_market_maps with baseIsToken0 for each pool.
// Calls adapter.start(pool, allMappingsForPool, provider).
// One contract listener per pool — handles all markets.
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { ethers } from 'ethers';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { Chain, DexType, CHAIN_CONFIGS, getEnabledChains } from '@/ingestion/onchain/common/chain.config';
import { UniswapDiscoveryService } from './uniswap-pool-scanner.service';
import { UniswapV3Adapter } from './uniswap-v3.adapter';
import { ChainProviderFactory } from '@/ingestion/onchain/providers/provider.factory';
import { PoolMarketMapping } from '../base/dex-adapter.interface';

@Injectable()
export class UniswapV3OnchainService {
  private readonly logger = new Logger(UniswapV3OnchainService.name);

  // `${chainId}:${poolKey}` — prevents double-listening on cron re-runs
  private listeningPools    = new Set<string>();
  private discoveryRunning  = new Map<Chain, boolean>();

  constructor(
    @InjectRepository(DexPool)     private poolRepo: Repository<DexPool>,
    @InjectRepository(DexMarketMap) private mapRepo:  Repository<DexMarketMap>,
    private readonly discovery: UniswapDiscoveryService,
    private readonly adapter:   UniswapV3Adapter,
    private readonly chains:    ChainProviderFactory,
  ) {}

  // ── Called by OnchainService at boot ─────────────────────────
  async bootChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`${config.name} V3 booting...`);

    // Start listeners on existing DB pools
    await this.startListenersForChain(chainId, provider);

    // First discovery run (don't wait 6h for cron)
    await this.discoverForChain(chainId, provider);

    this.logger.log(`✅ ${config.name} V3 ready`);
  }

  // ── Cron: rediscover new pools every 6h on ALL chains ────────
  @Cron(CronExpression.EVERY_6_HOURS)
  async cronRediscovery() {
    this.logger.log('🔍 V3 cron rediscovery...');
    const enabled = getEnabledChains();
    await Promise.all(enabled.map(chain => {
      const provider = this.chains.get(chain.chainId);
      if (!provider) return Promise.resolve();
      return this.discoverForChain(chain.chainId, provider);
    }));
  }

  // ── Discovery for one chain ───────────────────────────────────
  private async discoverForChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    if (this.discoveryRunning.get(chainId)) return;
    this.discoveryRunning.set(chainId, true);
    try {
      await this.discovery.discover(chainId, provider);
      // After discovery, start listeners for any newly discovered pools
      await this.startListenersForChain(chainId, provider);
    } catch (err) {
      this.logger.error(`${CHAIN_CONFIGS[chainId].name} V3 discovery failed`, err);
    } finally {
      this.discoveryRunning.set(chainId, false);
    }
  }

  // ── Attach listeners for all active pools on a chain ─────────
  private async startListenersForChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    const allPools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V3, chainId },
      relations: ['token0', 'token1'],
    });

    if (!allPools.length) return;

    // Init balances + prices for ALL pools (multicall)
    await this.adapter.initializePools(allPools, CHAIN_CONFIGS[chainId].name);

    // Filter to active pools worth listening on
    const topPools = allPools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 100);

    if (!topPools.length) return;

    // Load ALL market mappings for top pools WITH baseIsToken0
    const poolIds  = topPools.map(p => p.id);
    const mappings = await this.mapRepo.find({
      where:     { poolId: In(poolIds) },
      relations: ['market'],
    });

    // Group: poolId → PoolMarketMapping[]
    // Each pool can have MULTIPLE market mappings (one per token with a market)
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

    let started = 0;
    for (const pool of topPools) {
      const key = `${chainId}:${pool.poolKey}`;
      if (this.listeningPools.has(key)) continue; // already listening — cron safe

      const poolMappings = mapByPool.get(pool.id);
      if (!poolMappings?.length) continue; // no market mapping yet — skip

      // ONE listener per pool handles ALL markets
      // ETH/USDC pool: one listener → publishes to ETH-USD AND USDC-USD
      this.adapter.start(pool, poolMappings, provider);
      this.listeningPools.add(key);
      started++;
    }

    if (started > 0) {
      this.logger.log(
        `👂 ${CHAIN_CONFIGS[chainId].name} V3: ${started} new listeners ` +
        `(${this.listeningPools.size} total)`
      );
    }
  }
}














// @Injectable()
// export class UniswapV3OnchainService implements OnModuleInit {

//   private logger = new Logger(UniswapV3OnchainService.name);

//   constructor(
//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,

//     @InjectRepository(DexMarketMap)
//     private mapRepo: Repository<DexMarketMap>,

//     private readonly uniswap: UniswapV3Adapter,
//   ) { }
//   async onModuleInit() {
//     this.logger.log('🚀 Starting V3 engine...');
 
//     // ── STEP 1: Load all V3 pools that have a market mapping ─────────
//     // No liquidity filter here yet — we need balances first.
//     // isInitialized=false means they haven't had a multicall run yet.
//     const allPools = await this.poolRepo.find({
//       where: { dex: DexType.UNISWAP_V3 },
//       relations: ['token0', 'token1'],
//     });
 
//     this.logger.log(`📦 Total V3 pools: ${allPools.length}`);
 
//     // ── STEP 2: Multicall balance fetch + liquidity compute ───────────
//     // SharedLiquidityService.initializePools() saves pools internally,
//     // sets isInitialized=true, and marks isActive based on liquidityUsd.
//     // ✅ Do NOT call poolRepo.save() after this — already done inside.
//     await this.uniswap.initializePools(allPools, 'ETH');
 
//     this.logger.log('💧 Liquidity initialized');
 
//     // ── STEP 3: Filter to top pools AFTER we have real balances ───────
//     const topPools = allPools
//       .filter(p => p.isActive && p.liquidityUsd > 1000)
//       .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
//       .slice(0, 100);
 
//     this.logger.log(`🔥 Top V3 pools: ${topPools.length}`);
 
//     if (!topPools.length) {
//       this.logger.warn('⚠️  No active pools found — check token sync and price cache');
//       return;
//     }
 
//     // ── STEP 4: Load market mappings for top pools only ───────────────
//     const poolIds = topPools.map(p => p.id);
 
//     const mappings = await this.mapRepo.find({
//       where: { poolId: In(poolIds) },
//       relations: ['market'], // ✅ must load market relation for m.market.base
//     });
 
//     // Group: poolId → [{ marketId, base }]
//     const mapByPool = new Map<number, { marketId: number; base: string }[]>();
//     for (const m of mappings) {
//       if (!m.market) continue; // guard against orphaned mappings
//       if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
//       mapByPool.get(m.poolId)!.push({ marketId: m.marketId, base: m.market.base });
//     }
 
//     // ── STEP 5: Start listeners for pools that have market mappings ───
//     let started = 0;
//     for (const pool of topPools) {
//       const markets = mapByPool.get(pool.id);
//       if (!markets?.length) continue; // pool exists in DEX but not linked to any market
 
//       for (const m of markets) {
//         this.uniswap.start(pool, m.marketId, m.base);
//         started++;
//       }
//     }
 
//     this.logger.log(`✅ V3 engine running — ${started} listeners on ${topPools.length} pools`);
//   }


// }








// import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
// import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
// import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { In, Repository } from 'typeorm';
// import { UniswapV3Adapter } from './uniswap-v3.adapter';
// import { DexType } from '@/ingestion/onchain/common/chain.enum';


// @Injectable()
// export class UniswapV3OnchainService implements OnModuleInit {

//   private logger = new Logger(UniswapV3OnchainService.name);

//   constructor(
//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,

//     @InjectRepository(DexMarketMap)
//     private mapRepo: Repository<DexMarketMap>,

//     private readonly uniswap: UniswapV3Adapter,
//   ) { }

//   async onModuleInit() {
//     console.log("sssssssssss")
//     this.logger.log('🚀 Starting DEX engine...');

//     // 🔥 STEP 1: LOAD ALL POOLS
//     const allPools = await this.poolRepo.find({
//       where: { dex: DexType.UNISWAP_V3, isActive: true },
//       relations: ['token0', 'token1'],
//       order: {
//         score: 'DESC',
//       },
//     });

//     this.logger.log(`📦 Total pools: ${allPools.length}`);

//     // 🔥 STEP 2: INITIALIZE ALL LIQUIDITY (MULTICALL)
//     await this.uniswap.initializePools(allPools, 'ETH');

//     // 🔥 STEP 3: SAVE UPDATED LIQUIDITY
//     await this.poolRepo.save(allPools);

//     this.logger.log(`💧 Liquidity initialized for all pools`);

//     // 🔥 STEP 4: PICK TOP POOLS (LAZY LOAD)
//     const topPools = allPools
//       .filter(p => p.liquidityUsd && p.liquidityUsd > 1000)
//       .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
//       .slice(0, 100);

//     this.logger.log(`🔥 Top pools selected: ${topPools.length}`);

//     // 🔥 STEP 5: LOAD MARKET MAPPINGS
//     const poolIds = topPools.map(p => p.id);

//     const mappings = await this.mapRepo.find({
//       where: { poolId: In(poolIds) },
//       relations: ['market'],
//     });

//     const mapByPool = new Map<number, { marketId: number; base: string }[]>();

//     for (const m of mappings) {
//       if (!mapByPool.has(m.poolId)) {
//         mapByPool.set(m.poolId, []);
//       }

//       mapByPool.get(m.poolId)!.push({
//         marketId: m.marketId,
//         base: m.market.base,
//       });
//     }

//     // 🔥 STEP 6: START LISTENERS ONLY FOR TOP POOLS
//     for (const pool of topPools) {

//       const markets = mapByPool.get(pool.id);
//       if (!markets?.length) continue;

//       for (const m of markets) {
//         this.uniswap.start(pool, m.marketId, m.base);
//       }
//     }

//     this.logger.log(`✅ DEX engine running with ${topPools.length} live pools`);
//   }
// }


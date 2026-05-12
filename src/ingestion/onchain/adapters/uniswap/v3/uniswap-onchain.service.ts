// ============================================================
// uniswap-v3-onchain.service.ts  (uniswap-onchain.service.ts)
//
// Handles V3 for ALL chains — one service, any chain.
// Called by OnchainService.bootChain(chainId, provider).
//
// Per-chain state is keyed by chainId so Ethereum and BSC
// don't interfere with each other's pools or listeners.
//
// Cron runs every 6h and rediscovers new pools on ALL
// enabled chains in one pass.
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { ethers } from 'ethers';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { Chain, DexType, CHAIN_CONFIGS, getEnabledChains } from '@/ingestion/onchain/common/chain.config';
import { UniswapV3Adapter } from './uniswap-v3.adapter';
import { ChainProviderFactory } from '@/ingestion/onchain/providers/provider.factory';
import { UniswapDiscoveryService } from './uniswap-pool-scanner.service';

@Injectable()
export class UniswapV3OnchainService {
  private readonly logger = new Logger(UniswapV3OnchainService.name);

  // Per-chain listener tracking: `${chainId}:${poolKey}` → true
  // Prevents double-attaching Swap/Mint/Burn when cron re-runs
  private listeningPools = new Set<string>();

  // Per-chain discovery lock: chainId → boolean
  private discoveryRunning = new Map<Chain, boolean>();

  constructor(
    @InjectRepository(DexPool)      private poolRepo: Repository<DexPool>,
    @InjectRepository(DexMarketMap) private mapRepo:  Repository<DexMarketMap>,
    private readonly discovery: UniswapDiscoveryService,
    private readonly adapter:   UniswapV3Adapter,
    private readonly chains:    ChainProviderFactory,
  ) {}

  // ── Called by OnchainService per chain at boot ────────────
  async bootChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`${config.name} V3 booting...`);

    // Step 1: Attach listeners on existing DB pools immediately
    await this.startListenersForChain(chainId, provider);

    // Step 2: Run first discovery immediately — don't wait for cron
    await this.discoverForChain(chainId, provider);

    this.logger.log(`✅ ${config.name} V3 ready`);
  }

  // ── Cron: rediscover new pools on ALL enabled chains every 6h ─
  @Cron(CronExpression.EVERY_6_HOURS)
  async cronRediscovery() {
    this.logger.log('🔍 V3 cron rediscovery starting...');

    const enabled = getEnabledChains();

    // Run all chains in parallel — each is independently locked
    await Promise.all(
      enabled.map(chain => {
        const provider = this.chains.get(chain.chainId);
        if (!provider) return Promise.resolve();
        return this.discoverForChain(chain.chainId, provider);
      })
    );

    this.logger.log('✅ V3 cron rediscovery complete');
  }

  // ── Discovery for one chain ───────────────────────────────
  private async discoverForChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    if (this.discoveryRunning.get(chainId)) {
      this.logger.warn(`${CHAIN_CONFIGS[chainId].name} V3 discovery already running — skipping`);
      return;
    }

    this.discoveryRunning.set(chainId, true);

    try {
      // UniswapDiscoveryService.discover() already accepts chainId
      // It uses CHAIN_CONFIGS[chainId].uniswapV3Factory for the factory address
      // await this.discovery.discover(chainId, provider);

      // After discovery, check for new pools needing listeners
      await this.startListenersForChain(chainId, provider);

    } catch (err) {
      this.logger.error(`${CHAIN_CONFIGS[chainId].name} V3 discovery failed`, err);
    } finally {
      this.discoveryRunning.set(chainId, false);
    }
  }

  // ── Attach listeners on top pools for a chain ────────────
  private async startListenersForChain(chainId: Chain, provider: ethers.WebSocketProvider) {
    const allPools = await this.poolRepo.find({
      where:     { dex: DexType.UNISWAP_V3, chainId },
      relations: ['token0', 'token1'],
    });
console.log("dex uniswpav3",allPools.length)
    if (!allPools.length) return;

    // Initialize balances + startup prices (multicall: balanceOf + slot0)
    await this.adapter.initializePools(allPools, CHAIN_CONFIGS[chainId].name);

    const topPools = allPools
      .filter(p => p.isActive && (p.liquidityUsd > 1000 || p.token0Balance > 0))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, 100);

    if (!topPools.length) {
      this.logger.warn(`${CHAIN_CONFIGS[chainId].name} V3: no active pools`);
      return;
    }

    const poolIds  = topPools.map(p => p.id);
    const mappings = await this.mapRepo.find({
      where:     { poolId: In(poolIds) },
      relations: ['market'],
    });

    const mapByPool = new Map<number, { marketId: number; base: string }[]>();
    for (const m of mappings) {
      if (!m.market) continue;
      if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
      mapByPool.get(m.poolId)!.push({ marketId: m.marketId, base: m.market.base });
    }

    let started = 0;
    for (const pool of topPools) {
      // Key includes chainId so ETH WETH/USDC and ARB WETH/USDC
      // don't collide even if poolKey happens to be the same
      const key = `${chainId}:${pool.poolKey}`;
      if (this.listeningPools.has(key)) continue; // already listening

      const markets = mapByPool.get(pool.id);
      if (!markets?.length) continue;

      for (const m of markets) {
        // Pass provider per chain — each chain has its own WS connection
        this.adapter.start(pool, m.marketId, m.base, provider);
        started++;
      }

      this.listeningPools.add(key);
    }

    if (started > 0) {
      this.logger.log(
        `👂 ${CHAIN_CONFIGS[chainId].name} V3: ${started} new listeners ` +
        `(${this.listeningPools.size} total across all chains)`
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


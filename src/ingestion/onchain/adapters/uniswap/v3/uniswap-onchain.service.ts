import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UniswapV3Adapter } from './uniswap-v3.adapter';
import { DexType } from '@/ingestion/onchain/common/chain.enum';


@Injectable()
export class UniswapV3OnchainService implements OnModuleInit {

  private logger = new Logger(UniswapV3OnchainService.name);

  constructor(
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,

    @InjectRepository(DexMarketMap)
    private mapRepo: Repository<DexMarketMap>,

    private readonly uniswap: UniswapV3Adapter,
  ) { }
  async onModuleInit() {
    this.logger.log('🚀 Starting V3 engine...');
 
    // ── STEP 1: Load all V3 pools that have a market mapping ─────────
    // No liquidity filter here yet — we need balances first.
    // isInitialized=false means they haven't had a multicall run yet.
    const allPools = await this.poolRepo.find({
      where: { dex: DexType.UNISWAP_V3 },
      relations: ['token0', 'token1'],
    });
 
    this.logger.log(`📦 Total V3 pools: ${allPools.length}`);
 
    // ── STEP 2: Multicall balance fetch + liquidity compute ───────────
    // SharedLiquidityService.initializePools() saves pools internally,
    // sets isInitialized=true, and marks isActive based on liquidityUsd.
    // ✅ Do NOT call poolRepo.save() after this — already done inside.
    await this.uniswap.initializePools(allPools, 'ETH');
 
    this.logger.log('💧 Liquidity initialized');
 
    // ── STEP 3: Filter to top pools AFTER we have real balances ───────
    const topPools = allPools
      .filter(p => p.isActive && p.liquidityUsd > 1000)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
      .slice(0, 100);
 
    this.logger.log(`🔥 Top V3 pools: ${topPools.length}`);
 
    if (!topPools.length) {
      this.logger.warn('⚠️  No active pools found — check token sync and price cache');
      return;
    }
 
    // ── STEP 4: Load market mappings for top pools only ───────────────
    const poolIds = topPools.map(p => p.id);
 
    const mappings = await this.mapRepo.find({
      where: { poolId: In(poolIds) },
      relations: ['market'], // ✅ must load market relation for m.market.base
    });
 
    // Group: poolId → [{ marketId, base }]
    const mapByPool = new Map<number, { marketId: number; base: string }[]>();
    for (const m of mappings) {
      if (!m.market) continue; // guard against orphaned mappings
      if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
      mapByPool.get(m.poolId)!.push({ marketId: m.marketId, base: m.market.base });
    }
 
    // ── STEP 5: Start listeners for pools that have market mappings ───
    let started = 0;
    for (const pool of topPools) {
      const markets = mapByPool.get(pool.id);
      if (!markets?.length) continue; // pool exists in DEX but not linked to any market
 
      for (const m of markets) {
        this.uniswap.start(pool, m.marketId, m.base);
        started++;
      }
    }
 
    this.logger.log(`✅ V3 engine running — ${started} listeners on ${topPools.length} pools`);
  }


}








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


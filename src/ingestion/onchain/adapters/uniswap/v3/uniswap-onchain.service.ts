import { DexMarketMap } from '@/ingestion/onchain/common/entities/pool-market.entity';
import { DexPool } from '@/ingestion/onchain/common/entities/pool.entityt';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UniswapV3Adapter } from './uniswap-v3.adapter';


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
console.log("sssssssssss")
    this.logger.log('🚀 Starting DEX engine...');

    // 🔥 STEP 1: LOAD ALL POOLS
    const allPools = await this.poolRepo.find({
      // where: { isActive: true },
      relations: ['token0', 'token1'],
      order: {
        score: 'DESC',
      },
    });

    this.logger.log(`📦 Total pools: ${allPools.length}`);

    // 🔥 STEP 2: INITIALIZE ALL LIQUIDITY (MULTICALL)
    await this.uniswap.initializePools(allPools, 'ETH');

    // 🔥 STEP 3: SAVE UPDATED LIQUIDITY
    await this.poolRepo.save(allPools);

    this.logger.log(`💧 Liquidity initialized for all pools`);

    // 🔥 STEP 4: PICK TOP POOLS (LAZY LOAD)
    const topPools = allPools
      .filter(p => p.liquidityUsd && p.liquidityUsd > 1000)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
      .slice(0, 100);

    this.logger.log(`🔥 Top pools selected: ${topPools.length}`);

    // 🔥 STEP 5: LOAD MARKET MAPPINGS
    const poolIds = topPools.map(p => p.id);

    const mappings = await this.mapRepo.find({
      where: { poolId: In(poolIds) },
    });

    const mapByPool = new Map<number, number[]>();

    for (const m of mappings) {
      if (!mapByPool.has(m.poolId)) {
        mapByPool.set(m.poolId, []);
      }
      mapByPool.get(m.poolId)!.push(m.marketId);
    }

    // 🔥 STEP 6: START LISTENERS ONLY FOR TOP POOLS
    for (const pool of topPools) {

      const markets = mapByPool.get(pool.id);
      if (!markets?.length) continue;

      for (const marketId of markets) {
        this.uniswap.start(pool, marketId,);
      }
    }

    this.logger.log(`✅ DEX engine running with ${topPools.length} live pools`);
  }
}


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

//     this.logger.log('🚀 Starting DEX engine...');

//     // 🔥 load first batch (multi-chain optional)
//     const pools = await this.poolRepo.find({
//       where: { isActive: true },
//       relations: ['token0', 'token1'],
//     });
//     this.logger.log(`📦 Total pools: ${allPools.length}`);

//     const poolIds = pools.map(p => p.id);

//     const mappings = await this.mapRepo.find({ where: { poolId: In(poolIds) } });

//     const mapByPool = new Map<number, number[]>();
//     for (const m of mappings) {
//       if (!mapByPool.has(m.poolId)) mapByPool.set(m.poolId, []);
//       mapByPool.get(m.poolId)!.push(m.marketId);
//     }

//     // 🔥 initialize pools multicall
//     await this.uniswap.initializePools(pools, 'ETH');

//     // 🔥 start listeners
//     for (const pool of pools) {
//       try {
//       const markets = mapByPool.get(pool.id);
//       if (!markets?.length) continue;
//       for (const marketId of markets) this.uniswap.start(pool, marketId );
//     } catch (err) {
//       this.logger.error(`❌ Failed uniswap.start ${pool.poolAddress}`, err);
//     }
//     }

//     this.logger.log(`✅ DEX engine started with ${pools.length} pools`);
//   }
// }
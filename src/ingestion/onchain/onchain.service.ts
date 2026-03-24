import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DexMarketMap } from './common/entities/pool-market.entity';
import { UniswapV3Adapter } from './adapters/uniswap/uniswap-v3.adapter';
import { DexPool } from './common/entities/pool.entityt';
 
@Injectable()
export class OnchainService implements OnModuleInit {

  private logger = new Logger(OnchainService.name);

  constructor(
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,

    @InjectRepository(DexMarketMap)
    private mapRepo: Repository<DexMarketMap>,

    private readonly uniswap: UniswapV3Adapter,
  ) {}

  async onModuleInit() {

    this.logger.log('Starting DEX engine...');

    // 🔥 load only active + good pools
    const pools = await this.poolRepo.find({
      where: {
        isActive: true,
      },
      relations: ['token0', 'token1'],
      order: { score: 'DESC' },
      take: 100 // limit for safety
    });

    const poolIds = pools.map(p => p.id);

    const mappings = await this.mapRepo.find({
      where: {
        poolId: In(poolIds)
      },
      relations: ['market']
    });

    const mapByPool = new Map<number, number[]>();

    for (const m of mappings) {
      if (!mapByPool.has(m.poolId)) {
        mapByPool.set(m.poolId, []);
      }
      mapByPool.get(m.poolId)!.push(m.marketId);
    }

    for (const pool of pools) {

      const markets = mapByPool.get(pool.id);
      if (!markets?.length) continue;

      for (const marketId of markets) {

        this.uniswap.start(
          pool,
          marketId
        );

      }

    }

    this.logger.log(`DEX engine started with ${pools.length} pools`);
  }
}
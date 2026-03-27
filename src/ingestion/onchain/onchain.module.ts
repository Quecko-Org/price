import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';


import { OnchainService } from './onchain.service';
import { UniswapV3Adapter } from './adapters/uniswap/uniswap-v3.adapter';
import { DexPool } from './common/entities/pool.entityt';
import { DexMarketMap } from './common/entities/pool-market.entity';
import { UniswapOnChainService } from './adapters/uniswap/uniswap-onchain.service';
import { PoolRankingService } from './adapters/uniswap/pool-ranking-service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DexPool, DexMarketMap]),
  ],
  providers: [
    OnchainService,
  ],
})
export class OnchainModule {}
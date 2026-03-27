
import { Module } from "@nestjs/common";
import { UniswapDiscoveryService } from "./uniswap-pool-scanner.service";
import { UniswapV3Adapter } from "./uniswap-v3.adapter";
import { UniswapOnChainService } from "./uniswap-onchain.service";
import { PoolRankingService } from "./pool-ranking-service";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { PriceCacheService } from "../../common/price-cache.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Token } from "../../common/entities/token.entity";
import { DexPool } from "../../common/entities/pool.entityt";
import { DexMarketMap } from "../../common/entities/pool-market.entity";
import { MarketEntity } from "@/market-data/market.entity";


@Module({
    imports: [
        TypeOrmModule.forFeature([Token,DexPool,DexMarketMap,MarketEntity]),
      ],
    providers: [
        EthereumProvider,
        UniswapV3Adapter,
        UniswapDiscoveryService,
        UniswapOnChainService,
        PoolRankingService,
        PriceCacheService,
    ],
    exports: [
        TypeOrmModule,
        EthereumProvider,
        UniswapV3Adapter,
        UniswapDiscoveryService,
        UniswapOnChainService,
        PoolRankingService]



  })
  export class UniswapModule {}
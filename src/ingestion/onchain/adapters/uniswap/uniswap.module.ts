
import { Module } from "@nestjs/common";
import { UniswapV3Adapter } from "./v3/uniswap-v3.adapter";
import { PoolRankingService } from "./v3/pool-ranking-service";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Token } from "../../common/entities/token.entity";
import { DexPool } from "../../common/entities/pool.entityt";
import { DexMarketMap } from "../../common/entities/pool-market.entity";
import { MarketEntity } from "@/market-data/market.entity";
import { V3LiquidityUpdaterService } from "./v3/liquidity-updater.service";
import { UniswapV3OnchainService } from "./v3/uniswap-onchain.service";
import { V4LiquidityService } from "./v4/v4-liquidity.service";
import { UniswapV4DiscoveryService } from "./v4/uniswapv4-pool-scanner";
import { UniswapV4OnchainService } from "./v4/uniswap-v4.onchain.service";
import { UniswapV4Adapter } from "./v4/uniswap-v4.adapter";
import { SharedLiquidityService } from "./base/shared-liquidity.service";
import { IngestionCronModule } from "../../common/ingestion-cron/ingestion-cron.module";


@Module({
    imports: [
        TypeOrmModule.forFeature([Token,DexPool,DexMarketMap,MarketEntity]),
        IngestionCronModule
      ],
    providers: [
        EthereumProvider,
        UniswapV3Adapter,
        // UniswapV3OnchainService,
        PoolRankingService
         ,UniswapV4DiscoveryService,
         UniswapV4OnchainService,UniswapV4Adapter,SharedLiquidityService
        
    ],
    exports: [
        UniswapV3Adapter,
        
        PoolRankingService
        // UniswapV3OnchainService
         ,UniswapV4DiscoveryService,UniswapV4OnchainService,UniswapV4Adapter,SharedLiquidityService

    
    ]



  })
  export class UniswapModule {}

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


@Module({
    imports: [
        TypeOrmModule.forFeature([Token,DexPool,DexMarketMap,MarketEntity]),
      ],
    providers: [
        EthereumProvider,
        UniswapV3Adapter,
        UniswapV3OnchainService,
        PoolRankingService,
        V3LiquidityUpdaterService,
        
    ],
    exports: [
        UniswapV3Adapter,
        V3LiquidityUpdaterService,
        PoolRankingService,
        UniswapV3OnchainService
    
    ]



  })
  export class UniswapModule {}
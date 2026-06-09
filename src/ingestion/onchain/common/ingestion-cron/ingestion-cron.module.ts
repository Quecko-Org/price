
import { DexMarketMap } from "@/ingestion/onchain/common/entities/pool-market.entity";
import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
import { Token } from "@/ingestion/onchain/common/entities/token.entity";

import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
import { SymbolsModule } from "@/ingestion/symbols/symbols.module";
import { MarketEntity } from "@/market-data/market.entity";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { IngestionCronService } from "./ingestion-cron.service";
import { DexAutoMapperService } from "./token-syncing/dex-auto-mapper.service";
import { TokenSyncService } from "./token-syncing/token-sync.service";
import { UniswapDiscoveryService } from "../../adapters/uniswap/v3/uniswap-pool-scanner.service";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { CommonModuleModule } from "@/common-module/common-module.module";

@Module({
  imports: [TypeOrmModule.forFeature([SymbolEntity, Token, DexPool, MarketEntity, DexMarketMap]),
    SymbolsModule,
        CommonModuleModule,


  ],
  providers: [IngestionCronService, TokenSyncService,
    UniswapDiscoveryService, EthereumProvider,
    DexAutoMapperService],
  exports: [IngestionCronService, TokenSyncService,
    UniswapDiscoveryService,
    DexAutoMapperService],
})
export class IngestionCronModule { }
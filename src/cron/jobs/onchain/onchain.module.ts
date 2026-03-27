import { AdapterModule } from "@/ingestion/onchain/adapters/adapters.module";
import { LiquidityUpdaterService } from "@/ingestion/onchain/common/cron/liquidity-updater.service";
import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
import { Token } from "@/ingestion/onchain/common/entities/token.entity";
import { DexAutoMapperService } from "@/ingestion/onchain/common/token-syncing/dex-auto-mapper.service";
import { TokenSyncService } from "@/ingestion/onchain/common/token-syncing/token-sync.service";
import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
 imports:[TypeOrmModule.forFeature([SymbolEntity,Token])
 ,AdapterModule],
    providers: [LiquidityUpdaterService,TokenSyncService,DexAutoMapperService],
    exports: [LiquidityUpdaterService,TokenSyncService,DexAutoMapperService],
  })
  export class OnchainCronModule {}
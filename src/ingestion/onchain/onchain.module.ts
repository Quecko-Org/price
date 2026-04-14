import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';


import { OnchainService } from './onchain.service';
import { DexPool } from './common/entities/pool.entityt';
import { DexMarketMap } from './common/entities/pool-market.entity';
import { AdapterModule } from './adapters/adapters.module';
import { EthereumProvider } from './providers/ethereum.provider';
import { IngestionCronModule } from './common/ingestion-cron/ingestion-cron.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DexPool, DexMarketMap]),
    AdapterModule,
    IngestionCronModule
  ],
  providers: [
    OnchainService,
    EthereumProvider
  ],
})
export class OnchainModule {}
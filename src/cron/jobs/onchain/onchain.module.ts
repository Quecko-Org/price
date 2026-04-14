
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OnchainCron } from "./onchain.cron";
import { IngestionCronModule } from "@/ingestion/onchain/common/ingestion-cron/ingestion-cron.module";

@Module({
 imports:[TypeOrmModule.forFeature([]),
 IngestionCronModule
], 
    providers: [OnchainCron],
    exports: [OnchainCron],
  }) 
  export class OnchainCronModule {}
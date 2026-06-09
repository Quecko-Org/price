
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OnchainCron } from "./onchain.cron";

@Module({
 imports:[TypeOrmModule.forFeature([]),
], 
    providers: [OnchainCron],
    exports: [OnchainCron],
  }) 
  export class OnchainCronModule {}
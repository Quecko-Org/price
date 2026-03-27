
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { OffChainModule } from "./jobs/offchain/offchain.module";
import { OnchainCron } from "./jobs/onchain/onchain.cron";
import { OnchainCronModule } from "./jobs/onchain/onchain.module";
// import { OffChainCron } from "./jobs/offchain/offchain.cron";



@Module({
    imports: [
        ScheduleModule.forRoot(),
        // OffChainModule,
        OnchainCronModule
      ],
    providers: [
      // OffChainCron,
      OnchainCron],

  })
  export class CronModule {}
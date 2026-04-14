
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { OnchainCronModule } from "./jobs/onchain/onchain.module";



@Module({
    imports: [
        ScheduleModule.forRoot(),
        // OffChainModule, 
        OnchainCronModule
      ],

  })
  export class CronModule {}
import { LiquidityUpdaterService } from '@/ingestion/onchain/common/cron/liquidity-updater.service';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OnchainCron {
  constructor(
    private readonly liquidityService: LiquidityUpdaterService,
  ) {}

  // every 5 min
  @Cron('*/1 * * * *')
  async updateLiquidity() {
    console.log('⛓ Updating liquidity...');
    await this.liquidityService.update();
  }
 
  // every 10 min
  // @Cron('0 */10 * * * *')
  @Cron('*/1 * * * *')
  async fullSync() {
    console.log('🔄 Running full sync...');
    // await this.liquidityService.fullSync();
  }
}
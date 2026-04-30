import { IngestionCronService } from '@/ingestion/onchain/common/ingestion-cron/ingestion-cron.service';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OnchainCron {
  constructor(
    private readonly ingestionCronService: IngestionCronService,
  ) { }


  
  @Cron('*/10 * * * *')
  async fullSync() {
    console.log('🔄 Running full sync...');
    await this.ingestionCronService.fullSync();
  }

}
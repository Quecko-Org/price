import { Module } from '@nestjs/common';
import { OnchainService } from './onchain.service';

@Module({
  providers: [OnchainService]
})
export class OnchainModule {}
 
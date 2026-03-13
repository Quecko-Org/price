import { Module } from '@nestjs/common';
import { MarketsModule } from './v1/markets/markets.module';
import { PaymentsModule } from './v1/payments/payments.module';
import { ApiKeysService } from './v1/api-keys/api-keys.service';
import { ApiKeysModule } from './v1/api-keys/api-keys.module';



@Module({  imports: [
  MarketsModule,
  PaymentsModule,
  ApiKeysModule,
  ],
})
export class ApiModule {}

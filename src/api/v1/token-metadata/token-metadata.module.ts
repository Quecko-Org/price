// ============================================================
// token-metadata.module.ts
// ============================================================
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenMetadataEntity } from './token-metadata.entity';
import { TokenMetadataService } from './token-metadata.service';
import { MarketEntity } from '@/market-data/market.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenMetadataEntity, MarketEntity]),
  ],
  providers: [TokenMetadataService],
  exports:   [TokenMetadataService],
})
export class TokenMetadataModule {}
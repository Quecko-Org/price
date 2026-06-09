

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolEntity } from './entities/symbol.entity';
import { SymbolExchangeEntity } from './entities/symbol-exchange.entity';
import { SymbolsService } from './symbol.service';
import { FxRateEntity } from './entities/fx-rate.entity';
import { MarketEntity } from '@/market-data/market.entity';
import { CommonModuleModule } from '@/common-module/common-module.module';

@Module({
    imports: [
      TypeOrmModule.forFeature([
        SymbolEntity,
        SymbolExchangeEntity, 
        FxRateEntity,
        MarketEntity
      ]),
      CommonModuleModule
    ],
    providers: [SymbolsService],
    exports: [SymbolsService], 
  })
  export class SymbolsModule {}
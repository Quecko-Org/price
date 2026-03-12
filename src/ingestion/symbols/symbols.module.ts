

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolEntity } from './entities/symbol.entity';
import { SymbolExchangeEntity } from './entities/symbol-exchange.entity';
import { SymbolsService } from './symbol.service';
import { FxRateEntity } from './entities/fx-rate.entity';

@Module({
    imports: [
      TypeOrmModule.forFeature([
        SymbolEntity,
        SymbolExchangeEntity, 
        FxRateEntity
      ]),
    ],
    providers: [SymbolsService],
    exports: [SymbolsService], 
  })
  export class SymbolsModule {}
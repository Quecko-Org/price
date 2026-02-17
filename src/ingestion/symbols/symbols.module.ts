

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolEntity } from './entities/symbol.entity';
import { SymbolExchangeEntity } from './entities/symbol-exchange.entity';
import { SymbolsService } from './symbol.service';

@Module({
    imports: [
      TypeOrmModule.forFeature([
        SymbolEntity,
        SymbolExchangeEntity, 
      ]),
    ],
    providers: [SymbolsService],
    exports: [SymbolsService], 
  })
  export class SymbolsModule {}
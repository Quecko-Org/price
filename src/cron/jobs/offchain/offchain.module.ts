import { SymbolsService } from "@/ingestion/symbols/symbol.service";
import { Module } from "@nestjs/common";

@Module({
    providers: [SymbolsService],
    exports: [SymbolsService], // 👈 REQUIRED
  })
  export class OffChainModule {}
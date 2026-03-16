import { AggregationService } from "@/aggregation/aggregation.service";
import { SymbolsService } from "../symbols/symbol.service";
import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { error } from "console";

@Injectable()
export class BackfillJob {
  constructor(
    private readonly aggregationService: AggregationService,
    private readonly symbolsService: SymbolsService,
  ) {}

  /**
   * Backfill ALL symbols (first-time bootstrap)
   */
  // @Cron('*/10 * * * * *')
  async runInitialBackfill() {
    const symbols = await this.symbolsService.getAllSymbols();
    for (const s of symbols.slice(0,1)) {
      // console.log("symbols runInitialBackfill",s)

      try {
     
        // await this.aggregationService.backfillSymbol(
        //   s.id,
        //   s.symbol,
        // );
      } catch (e) {
        console.error(`Backfill failed for ${s.symbol}`, e.data);
        process.exit()
      }
    }
  }
}

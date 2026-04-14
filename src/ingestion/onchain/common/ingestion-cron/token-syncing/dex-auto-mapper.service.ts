import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { MarketEntity } from "@/market-data/market.entity";
import { DexPool } from "../../entities/pool.entityt";
import { DexMarketMap } from "../../entities/pool-market.entity";
import { STABLES } from "../../common-tokens";

const TOKEN_ALIAS: Record<string, string> = {
  WETH: "ETH",
  WBTC: "BTC",
};

@Injectable()
export class DexAutoMapperService {
  constructor(
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,

    @InjectRepository(MarketEntity)
    private marketRepo: Repository<MarketEntity>,

    @InjectRepository(DexMarketMap)
    private mapRepo: Repository<DexMarketMap>,
  ) { }

  async map() {
    const pools = await this.poolRepo.find({
      relations: ["token0", "token1"],
    });

    const markets = await this.marketRepo.find();

    // Map: base-USD → marketId
    const marketMap = new Map<string, number>();
    for (const m of markets) {
      marketMap.set(`${m.base}-USD`, m.id);
    }

    for (const p of pools) {

      // ✅ Determine base and quote
      let base: string | null = null;
      let quote: string | null = null;



      if (STABLES.includes(p.token0.symbol)) {
        base = TOKEN_ALIAS[p.token1.symbol] || p.token1.symbol;
        quote = TOKEN_ALIAS[p.token0.symbol] || p.token0.symbol;
      } else if (STABLES.includes(p.token1.symbol)) {
        base = TOKEN_ALIAS[p.token0.symbol] || p.token0.symbol;
        quote = TOKEN_ALIAS[p.token1.symbol] || p.token1.symbol;
      } else {
        // No stablecoin → cannot map to USD
        continue;
      }

      // ✅ Get marketId

      const marketId =
        marketMap.get(`${base}-USD`) || marketMap.get(`${base}-${quote}`);
      if (!marketId) continue;

      const exists = await this.mapRepo.exists({
        where: { poolId: p.id, marketId },
      });

      if (exists) continue;
      await this.mapRepo.save({ poolId: p.id, marketId });

      console.log(`✅ Mapped pool ${p.id}: ${base}-${quote} → marketId ${marketId}`);
    }
    console.log("endddddddd")
  }
}
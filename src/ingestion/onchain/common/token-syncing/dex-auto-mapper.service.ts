import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";


import { MarketEntity } from "@/market-data/market.entity";
import { DexPool } from "../entities/pool.entityt";
import { DexMarketMap } from "../entities/pool-market.entity";

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
  ) {}

  async map() {

    const pools = await this.poolRepo.find({
      // relations: ["token0", "token1"]
    });
// console.log("poolsssss",pools)
    const markets = await this.marketRepo.find();

    const marketMap = new Map<string, number>();

    for (const m of markets) {
      marketMap.set(`${m.base}-${m.quote}`, m.id);
    }

    for (const p of pools) {

      const base =
        TOKEN_ALIAS[p.token0.symbol] || p.token0.symbol;

        
      const quote =
        TOKEN_ALIAS[p.token1.symbol] || p.token1.symbol;

      const marketId =
        marketMap.get(`${base}-${quote}`) ||
        marketMap.get(`${base}-USD`);
        // console.log("base",base,quote,marketId)

      if (!marketId) continue;

      const exists = await this.mapRepo.findOne({
        where: {
          poolId: p.id,
          marketId,
        }
      });

      if (exists) continue;
      // console.log("exists",exists)

      await this.mapRepo.save({
        poolId: p.id,
        marketId,
      });
    }
  }
}
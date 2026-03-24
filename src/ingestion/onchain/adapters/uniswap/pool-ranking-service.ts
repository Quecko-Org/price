import { Repository } from "typeorm";
import { DexPool } from "../../common/entities/pool.entityt";
import { InjectRepository } from "@nestjs/typeorm";
import { Injectable } from "@nestjs/common";

@Injectable()
export class PoolRankingService {

  constructor(
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,
  ) {}

  async updateScores() {

    const pools = await this.poolRepo.find();

    for (const p of pools) {

      const liquidity = Number(p.liquidityUsd || 0);
      const volume = Number(p.volume24h || 0);

      const score =
        Math.log(liquidity + 1) * 0.7 +
        Math.log(volume + 1) * 0.3;

      p.score = score.toString();
    }

    await this.poolRepo.save(pools);
  }
}
import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";


@Injectable()
export class V4LiquidityService {

  constructor(
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,
    private priceCache: PriceCacheService,
    


  ) {}

  async compute(pool: DexPool) {

    const p0 = this.priceCache.getPrice(pool.token0.canonicalSymbol);
    const p1 = this.priceCache.getPrice(pool.token1.canonicalSymbol);

    if (!p0 || !p1) return;

    pool.liquidityUsd =
      pool.token0Balance * p0 +
      pool.token1Balance * p1;
  }

  async updateFromSwap(pool: DexPool, a0: number, a1: number) {
    pool.token0Balance += a0;
    pool.token1Balance += a1;
    await this.compute(pool);
  }

  async updateFromMint(pool: DexPool, a0: number, a1: number) {
    pool.token0Balance += a0;
    pool.token1Balance += a1;
    await this.compute(pool);
  }

  async updateFromBurn(pool: DexPool, a0: number, a1: number) {
    pool.token0Balance -= a0;
    pool.token1Balance -= a1;
    await this.compute(pool);
  }
}
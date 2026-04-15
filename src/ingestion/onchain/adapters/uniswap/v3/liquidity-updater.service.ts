import { Injectable } from "@nestjs/common";
import { ethers } from "ethers";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DexPool } from "../../../common/entities/pool.entityt";
import { EthereumProvider } from "../../../providers/ethereum.provider";
import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)"
];

@Injectable()
export class V3LiquidityUpdaterService {

  constructor(
    private readonly provider: EthereumProvider,
    private readonly priceCache: PriceCacheService,
    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,
  ) { }



  async fullRecalculation() {

    const pools = await this.poolRepo.find({
      relations: ["token0", "token1"],
    });

    const provider = this.provider.getProvider();

    for (const p of pools) {
      try {

        const token0 = new ethers.Contract(
          p.token0.address,
          ERC20_ABI,
          provider
        );

        const token1 = new ethers.Contract(
          p.token1.address,
          ERC20_ABI,
          provider
        );

        const [bal0, bal1] = await Promise.all([
          token0.balanceOf(p.poolAddress),
          token1.balanceOf(p.poolAddress),
        ]);

        // ✅ store balances (IMPORTANT)
        p.token0Balance = Number(bal0) / 10 ** p.token0.decimals;
        p.token1Balance = Number(bal1) / 10 ** p.token1.decimals;

        // ✅ update liquidity
        this.computeLiquidity(p);

      } catch (err) {
        console.log("❌ error pool", p.poolAddress, err);
      }
    }

    await this.poolRepo.save(pools);
  }

  /* =========================
     CORE CALCULATION (REUSABLE)
  ========================= */
  computeLiquidity(pool: DexPool) {

    const price0 = this.priceCache.getPrice(pool.token0.canonicalSymbol);
    const price1 = this.priceCache.getPrice(pool.token1.canonicalSymbol);
    // console.log("pr",price0,price1)
    if (!price0 || !price1) return;

    pool.liquidityUsd =
      (pool.token0Balance * price0) +
      (pool.token1Balance * price1);
  }

  /* =========================
     FAST UPDATE (events)
  ========================= */
  async updateFromSwap(
    pool: DexPool,
    amount0: number,
    amount1: number
  ) {

    pool.token0Balance += amount0 / 10 ** pool.token0.decimals;
    pool.token1Balance += amount1 / 10 ** pool.token1.decimals;

    this.computeLiquidity(pool);
    pool.isActive =
      pool.liquidityUsd > 1000 &&
      pool.token0Balance > 0 &&
      pool.token1Balance > 0;
    await this.poolRepo.save(pool);
  }

  async updateFromMint(
    pool: DexPool,
    amount0: number,
    amount1: number
  ) {

    pool.token0Balance += amount0 / 10 ** pool.token0.decimals;
    pool.token1Balance += amount1 / 10 ** pool.token1.decimals;

    this.computeLiquidity(pool);

    await this.poolRepo.save(pool);
  }

  async updateFromBurn(
    pool: DexPool,
    amount0: number,
    amount1: number
  ) {

    pool.token0Balance -= amount0 / 10 ** pool.token0.decimals;
    pool.token1Balance -= amount1 / 10 ** pool.token1.decimals;

    this.computeLiquidity(pool);

    await this.poolRepo.save(pool);
  }



}
import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { Exchange } from '@/common/enums/exchanges.enums';
import { AggregationService } from '@/aggregation/aggregation.service';
import { EthereumProvider } from '../../providers/ethereum.provider';
import { DexPool } from '../../common/entities/pool.entityt';
import { PriceCacheService } from '../../common/price-cache.service';
import { UNISWAP3_POOL_ABI } from '../../common/abi/uniswap.abi';

@Injectable()
export class UniswapV3Adapter {

  private logger = new Logger(UniswapV3Adapter.name);

  constructor(
    private readonly ethProvider: EthereumProvider,
    private readonly aggregationService: AggregationService,
    private readonly priceCache: PriceCacheService,
  ) {}

  start(pool: DexPool, marketId: number) {

    const provider = this.ethProvider.getProvider();
 
    const contract = new ethers.Contract(
      pool.poolAddress,
      UNISWAP3_POOL_ABI, // ✅ correct
      provider
    );

    contract.on("Swap", (...args) => {
      try {

        const sqrtPriceX96 = args[4] as bigint;

        const price = this.sqrtPriceToPrice(sqrtPriceX96);

        const volume = Math.abs(Number(args[2])); // amount0

        const usdPrice = this.normalizeToUSD(price, pool);

        if (!usdPrice) return;

        this.aggregationService.handleLiveCandle(
          marketId,
          Exchange.UNISWAP_V3,
          {
            exchange: Exchange.UNISWAP_V3,
            openTime: Date.now(),
            open: usdPrice,
            high: usdPrice,
            low: usdPrice,
            close: usdPrice,
            volume,
            quote: 'USD',
            isFinal: false,
          }
        );

      } catch (err) {
        this.logger.error(`Swap parse error ${pool.poolAddress}`, err);
      }
    });

    this.logger.log(`✅ Listening Uniswap pool: ${pool.poolAddress}`);
  }

  // 🔥 price conversion
  private sqrtPriceToPrice(sqrtPriceX96: bigint): number {
    const num = Number(sqrtPriceX96) ** 2;
    const denom = 2 ** 192;
    return num / denom;
  }

  // 🔥 USD normalization (CRITICAL)
  private normalizeToUSD(price: number, pool: DexPool): number | null {

    const t0 = pool.token0;
    const t1 = pool.token1;

    // USDC / USDT
    if (t1.symbol === 'USDC' || t1.symbol === 'USDT') {
      return price;
    }

    if (t0.symbol === 'USDC' || t0.symbol === 'USDT') {
      return 1 / price;
    }

    // ETH pairs
    if (t1.symbol === 'WETH' || t1.symbol === 'ETH') {
      const ethPrice = this.priceCache.getPriceSafe('ETH');
      if (!ethPrice) return null;
      return price * ethPrice;
    }

    if (t0.symbol === 'WETH' || t0.symbol === 'ETH') {
      const ethPrice = this.priceCache.getPriceSafe('ETH');
      if (!ethPrice) return null;
      return (1 / price) * ethPrice;
    }

    return null;
  }
}
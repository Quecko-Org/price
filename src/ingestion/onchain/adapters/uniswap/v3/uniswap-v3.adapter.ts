import { Injectable, Logger } from '@nestjs/common';
import { ethers, formatUnits } from 'ethers';
import { Exchange } from '@/common/enums/exchanges.enums';
import { AggregationService } from '@/aggregation/aggregation.service';
import { EthereumProvider } from '../../../providers/ethereum.provider';
import { DexPool } from '../../../common/entities/pool.entityt';
import { UNISWAP3_POOL_ABI } from '../../../common/abi/uniswap.abi';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
import { V3LiquidityUpdaterService } from './liquidity-updater.service';
import { TOKEN_ALIAS } from '@/ingestion/onchain/common/common-tokens';


const ERC20_IFACE = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)'
]);

const MULTICALL_ABI = [
  'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)'
];

// Example multicall address; replace per chain
const MULTICALL_ADDRESS: Record<string, string> = {
  ETH: '0xcA11bde05977b3631167028862bE2a173976CA11',
  POLYGON: '0x275617327c958bD06b5D6b871E7f491D76113dd',
  ARBITRUM: '0x842eC2c7D803033Edf55E478F461FC547Bc54EB2'
};


@Injectable()
export class UniswapV3Adapter {

  private logger = new Logger(UniswapV3Adapter.name);

  constructor(
    private readonly ethProvider: EthereumProvider,
    private readonly aggregationService: AggregationService,
    private readonly priceCache: PriceCacheService,
    private readonly liquidityService: V3LiquidityUpdaterService,
  ) {}


  async normalize(symbol: string) {
    return TOKEN_ALIAS[symbol] || symbol;
  }

  /* =========================
     INITIAL LIQUIDITY
  ========================= */
  async initializePools(pools: DexPool[], chain: string) {
    console.log("initializePools",pools.length)
    const provider = this.ethProvider.getProvider();
  
    const multicall = new ethers.Contract(
      MULTICALL_ADDRESS[chain],
      MULTICALL_ABI,
      provider
    );
  
    const calls: { target: string; callData: string }[] = [];
    const callMap: { pool: DexPool; type: 'token0' | 'token1' }[] = [];
  
    // 🔥 Build calls
    for (const pool of pools) {
      calls.push({
        target: pool.token0.address,
        callData: ERC20_IFACE.encodeFunctionData('balanceOf', [pool.poolAddress]),
      });
      callMap.push({ pool, type: 'token0' });
  
      calls.push({
        target: pool.token1.address,
        callData: ERC20_IFACE.encodeFunctionData('balanceOf', [pool.poolAddress]),
      });
      callMap.push({ pool, type: 'token1' });
    }
  
    // 🔥 CHUNKING (VERY IMPORTANT)
    const CHUNK_SIZE = 150;
  
    for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
      const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
      const chunkMap = callMap.slice(i, i + CHUNK_SIZE);
  console.log("CHUNK_SIZE",CHUNK_SIZE)
      try {
        const [, returnData] = await multicall.aggregate(chunkCalls);
  
        for (let j = 0; j < returnData.length; j++) {
          const { pool, type } = chunkMap[j];
  
          try {
            const decoded = ERC20_IFACE.decodeFunctionResult(
              'balanceOf',
              returnData[j]
            );
  
            const decimals =
              type === 'token0'
                ? pool.token0.decimals
                : pool.token1.decimals;
  
            const amount = Number(
              ethers.formatUnits(decoded[0], decimals)
            );
  
            if (type === 'token0') pool.token0Balance = amount;
            else pool.token1Balance = amount;
  
          } catch (err) {
            console.log("err in initializePools Decode failed for",err)

            this.logger.warn(`Decode failed for pool ${pool.poolAddress}`);
          }
        }
  
      } catch (err) {
        console.log("err in initializePools",err)
        this.logger.warn(`Multicall chunk failed at index ${i}`, err);
      }
    }
  
    // 🔥 Compute liquidity + update status
    for (const pool of pools) {
      await this.liquidityService.computeLiquidity(pool);
      // ✅ FIX isActive
      pool.isActive =
        pool.liquidityUsd > 1000 &&
        pool.token0Balance > 0 &&
        pool.token1Balance > 0;
    }
  
    this.logger.log(`💧 Initialized ${pools.length} pools`);
  }



  /* =========================
     START LISTENER
  ========================= */
  start(pool: DexPool, marketId: number, baseSymbol: string) {
console.log(" start starting")
    const provider = this.ethProvider.getProvider();

    const contract = new ethers.Contract(
      pool.poolAddress,
      UNISWAP3_POOL_ABI,
      provider
    );

    /* ===== SWAP ===== */
    contract.on("Swap", async (...args) => {
      try {
        // console.log("swapppp",...args)
        const amount0 = Number(formatUnits(args[2], pool.token0.decimals));
        const amount1 = Number(formatUnits(args[3], pool.token1.decimals));

        const sqrtPriceX96 = args[4] as bigint;

        const price = this.sqrtPriceToPrice(
          sqrtPriceX96,
          pool.token0.decimals,
          pool.token1.decimals
        );      
          const usdPrice = this.normalizeToUSD(price, pool);

        if (!usdPrice) return;


                let baseVolume: number;

                if (pool.token0.canonicalSymbol == baseSymbol) {
                  baseVolume = Math.abs(amount0);
                } else if (pool.token1.canonicalSymbol == baseSymbol) {
                  baseVolume = Math.abs(amount1);

                } else {
                  console.log("ssss",marketId,pool.token0.canonicalSymbol ,baseSymbol)
                  this.logger.warn("Base mismatch"
                  ,pool.token0.canonicalSymbol ,baseSymbol,pool.poolAddress);
                  return;
                }





console.log("amounts",args[2],args[3],amount0,amount1,pool.poolAddress)
        // ✅ Candle update
        this.aggregationService.handleLiveCandle(
          marketId,
         Exchange.UNISWAP_V3,
          {
            exchange:     Exchange.UNISWAP_V3,
            openTime: Date.now(),
            open: usdPrice,
            high: usdPrice,
            low: usdPrice,
            close: usdPrice,
            volume:baseVolume,
            quote: 'USD',
            isFinal: false,
          }
        );
        pool.lastSwapAt = Date.now();
        pool.volume24h += Math.abs(baseVolume);

        pool.score = String(
          Number(pool.liquidityUsd || 0) * 0.7 +
          Number(pool.volume24h || 0) * 0.3
        );

        // ✅ Liquidity update
        await this.liquidityService.updateFromSwap(pool, amount0, amount1);

      } catch (err) {
        this.logger.error(`Swap error ${pool.poolAddress}`, err);
      }
    });

    /* ===== MINT ===== */
    contract.on("Mint", async (...args) => {
      try {
        console.log("mint",...args)
        const amount0 = Number(args[5]);
        const amount1 = Number(args[6]);

        await this.liquidityService.updateFromMint(pool, amount0, amount1);

      } catch (err) {
        this.logger.error(`Mint error ${pool.poolAddress}`, err);
      }
    });

    /* ===== BURN ===== */
    contract.on("Burn", async (...args) => {
      try {
                console.log("mint",...args)

        const amount0 = Number(args[4]);
        const amount1 = Number(args[5]);

        await this.liquidityService.updateFromBurn(pool, amount0, amount1);

      } catch (err) {
        this.logger.error(`Burn error ${pool.poolAddress}`, err);
      }
    });

    this.logger.log(`👂 Listening ${pool.poolAddress}`);
  }

  /* =========================
     PRICE UTILS
  ========================= */

  private sqrtPriceToPrice(
    sqrtPriceX96: bigint,
    decimals0: number,
    decimals1: number
  ): number {
  
    const ratio = Number(sqrtPriceX96) / 2 ** 96;
    const price = ratio * ratio;
  
    // 🔥 adjust decimals
    return price * (10 ** (decimals0 - decimals1));
  }

  private normalizeToUSD(price: number, pool: DexPool): number | null {

    const t0 = pool.token0.canonicalSymbol;
    const t1 = pool.token1.canonicalSymbol;
  
    const p0 = this.priceCache.getPrice(t0);
    const p1 = this.priceCache.getPrice(t1);
  
    // token1 is priced → price is token0/token1
    if (p1) return price * p1;
  
    // token0 is priced → invert
    if (p0) return (1 / price) * p0;
  
    return null;
  }
}






// export class UniswapV3Adapter {

//   private logger = new Logger(UniswapV3Adapter.name);

//   constructor(
//     private readonly ethProvider: EthereumProvider,
//     private readonly aggregationService: AggregationService,
//     private priceCache: PriceCacheService
//   ) {}

//   start(pool: DexPool, marketId: number) {

//     const provider = this.ethProvider.getProvider();
 
//     const contract = new ethers.Contract(
//       pool.poolAddress,
//       UNISWAP3_POOL_ABI, // ✅ correct
//       provider
//     );

//     contract.on("Swap", (...args) => {
//       try {

//         const sqrtPriceX96 = args[4] as bigint;

//         const price = this.sqrtPriceToPrice(sqrtPriceX96);

//         const volume = Math.abs(Number(args[2])); // amount0

//         const usdPrice = this.normalizeToUSD(price, pool);

//         if (!usdPrice) return;

//         this.aggregationService.handleLiveCandle(
//           marketId,
//           Exchange.UNISWAP_V3,
//           {
//             exchange: Exchange.UNISWAP_V3,
//             openTime: Date.now(),
//             open: usdPrice,
//             high: usdPrice,
//             low: usdPrice,
//             close: usdPrice,
//             volume,
//             quote: 'USD',
//             isFinal: false,
//           }
//         );

//       } catch (err) {
//         this.logger.error(`Swap parse error ${pool.poolAddress}`, err);
//       }
//     });

//     this.logger.log(`✅ Listening Uniswap pool: ${pool.poolAddress}`);
//   }

//   // 🔥 price conversion
//   private sqrtPriceToPrice(sqrtPriceX96: bigint): number {
//     const num = Number(sqrtPriceX96) ** 2;
//     const denom = 2 ** 192;
//     return num / denom;
//   }

//   // 🔥 USD normalization (CRITICAL)
//   private normalizeToUSD(price: number, pool: DexPool): number | null {

//     const t0 = pool.token0;
//     const t1 = pool.token1;

//     // USDC / USDT
//     if (t1.symbol === 'USDC' || t1.symbol === 'USDT') {
//       return price;
//     }

//     if (t0.symbol === 'USDC' || t0.symbol === 'USDT') {
//       return 1 / price;
//     }

//     // ETH pairs
//     if (t1.symbol === 'WETH' || t1.symbol === 'ETH') {
//       const ethPrice = this.priceCache.getPrice('ETH');
//       if (!ethPrice) return null;
//       return price * ethPrice;
//     }

//     if (t0.symbol === 'WETH' || t0.symbol === 'ETH') {
//       const ethPrice = this.priceCache.getPrice('ETH');
//       if (!ethPrice) return null;
//       return (1 / price) * ethPrice;
//     }

//     return null;
//   }
// }
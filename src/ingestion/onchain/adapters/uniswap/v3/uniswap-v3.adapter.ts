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
import {  SharedLiquidityService } from '../base/shared-liquidity.service';
import { canonicalSymbol } from '../base/pool-filter';
import { OnchainUtil } from '@/ingestion/onchain/common/onchain.utils';




@Injectable()
export class UniswapV3Adapter {

  private logger = new Logger(UniswapV3Adapter.name);

  constructor(
    private readonly ethProvider: EthereumProvider,
    private readonly aggregationService: AggregationService,
    private readonly priceCache: PriceCacheService,
    private readonly liquidity: SharedLiquidityService,
  ) {}


  async normalize(symbol: string) {
    return TOKEN_ALIAS[symbol] || symbol;
  }


// ------------------------------------------------------------------
  // BATCH INIT  (multicall balances for all pools at startup)
  // ------------------------------------------------------------------
  async initializePools(pools: DexPool[], _chain: string) {
    // Delegate entirely to shared service
    await this.liquidity.initializePools(pools);
  }
 
  // ------------------------------------------------------------------
  // LIVE LISTENER  (one contract per pool)
  // ------------------------------------------------------------------
  start(pool: DexPool, marketId: number, baseSymbol: string) {
    const provider = this.ethProvider.getProvider();
 
    const contract = new ethers.Contract(
      pool.poolKey,
      UNISWAP3_POOL_ABI,
      provider
    );
 
    // ---- SWAP -------------------------------------------------------
    contract.on("Swap", async (...args) => {
      try {
        // args: [sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick]
        const sqrtPriceX96 = args[4] as bigint;
 
        // ✅ formatUnits here — these are raw int256 from the contract
        const amount0 = Number(formatUnits(args[2], pool.token0.decimals));
        const amount1 = Number(formatUnits(args[3], pool.token1.decimals));
        const price = OnchainUtil.sqrtPriceToPrice(
          sqrtPriceX96,
          pool.token0.decimals,
          pool.token1.decimals
        );
        let usdPrice
        if (price != null)  {   
         usdPrice = OnchainUtil.normalizeToUSD(price, pool, this.priceCache)
console.log("swap v3",usdPrice)
        if (!usdPrice || usdPrice <= 0) return;
        pool.price = usdPrice;
        }
        // ✅ Volume: use the base token's absolute amount
        // quoteTokenAddress tells us which side is quote, other side is base
        const baseIsToken0 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();
        const baseVolume   = baseIsToken0 ? Math.abs(amount0) : Math.abs(amount1);
 
        // Safety: base symbol must match the market we're updating
        const actualBase = canonicalSymbol(baseIsToken0 ? pool.token0 : pool.token1);
        if (actualBase !== baseSymbol) {
          this.logger.warn(`Base mismatch: expected ${baseSymbol} got ${actualBase} pool=${pool.poolKey}`);
          return;
        }
 
        this.aggregationService.handleLiveCandle(marketId, Exchange.UNISWAP_V3, {
          exchange: Exchange.UNISWAP_V3,
          openTime: Date.now(),
          open:     usdPrice,
          high:     usdPrice,
          low:      usdPrice,
          close:    usdPrice,
          volume:   baseVolume,
          quote:    'USD',
          isFinal:  false,
        });
 
        pool.lastSwapAt = Date.now();
        pool.volume24h += baseVolume;
        pool.score      = (pool.liquidityUsd ?? 0) * 0.7 + (pool.volume24h ?? 0) * 0.3;
 
        // ✅ Pass already-formatted amounts — no further decimal division in service
        await this.liquidity.updateFromSwap(pool, amount0, amount1);
 
      } catch (err) {
        this.logger.error(`Swap error ${pool.poolKey}`, err);
      }
    });
 
    // ---- MINT -------------------------------------------------------
    contract.on("Mint", async (...args) => {
      try {
        // args: [sender, owner, tickLower, tickUpper, amount, amount0, amount1]
        // amount0/amount1 are raw uint256
        const amount0 = Number(formatUnits(args[5], pool.token0.decimals));
        const amount1 = Number(formatUnits(args[6], pool.token1.decimals));
        await this.liquidity.updateFromMint(pool, amount0, amount1);
      } catch (err) {
        this.logger.error(`Mint error ${pool.poolKey}`, err);
      }
    });
 
    // ---- BURN -------------------------------------------------------
    contract.on("Burn", async (...args) => {
      try {
        // args: [owner, tickLower, tickUpper, amount, amount0, amount1]
        const amount0 = Number(formatUnits(args[4], pool.token0.decimals));
        const amount1 = Number(formatUnits(args[5], pool.token1.decimals));
        await this.liquidity.updateFromBurn(pool, amount0, amount1);
      } catch (err) {
        this.logger.error(`Burn error ${pool.poolKey}`, err);
      }
    });
 
    this.logger.log(`👂 V3 listening ${pool.poolKey}`);
  }
 
  // ------------------------------------------------------------------
  // PRICE UTILS
  // ------------------------------------------------------------------
 
  /**
   * Converts Uniswap sqrtPriceX96 → token0/token1 price ratio.
   * Result: how many token1 units per 1 token0 (in human-readable terms).
   */
  private sqrtPriceToPrice(sqrt: bigint, decimals0: number, decimals1: number): number {
    const ratio = Number(sqrt) / 2 ** 96;
    const raw   = ratio * ratio;
    // Adjust for decimal difference: multiply by 10^(d0-d1)
    return raw * (10 ** (decimals0 - decimals1));
  }
 
  /**
   * Converts the pool ratio price → USD using priceCache.
   *
   * Uses quoteTokenAddress to determine direction reliably,
   * with fallback to checking which side has a cached price.
   *
   *  price = token0 per token1
   *  if quote = token1  →  USD = price × token1_usd_price
   *  if quote = token0  →  USD = (1/price) × token0_usd_price
   */
  private normalizeToUSD(price: number, pool: DexPool): number | null {
    const quoteIsToken1 =
      pool.quoteTokenAddress === pool.token1.address.toLowerCase();
 
    const quoteToken  = quoteIsToken1 ? pool.token1 : pool.token0;
    const quoteSym    = canonicalSymbol(quoteToken);
    const quoteUsd    = this.priceCache.getPrice(quoteSym);
 
    // ✅ Only proceed if we have a real cached price (getPrice returns 1 as fallback)
    // We detect the fallback by checking both canonical symbols
    const sym0 = canonicalSymbol(pool.token0);
    const sym1 = canonicalSymbol(pool.token1);
    const p0   = this.priceCache.getPrice(sym0);
    const p1   = this.priceCache.getPrice(sym1);
 
    // At least one must be a known stable/wrapped with real price
    if (!p0 && !p1) return null;
 
    if (quoteIsToken1 && p1) return price * p1;
    if (!quoteIsToken1 && p0) return (1 / price) * p0;
 
    return null;
  }

}








/** stable coin spcific above with shared used by v4 also */

// import { Injectable, Logger } from '@nestjs/common';
// import { ethers, formatUnits } from 'ethers';
// import { Exchange } from '@/common/enums/exchanges.enums';
// import { AggregationService } from '@/aggregation/aggregation.service';
// import { EthereumProvider } from '../../../providers/ethereum.provider';
// import { DexPool } from '../../../common/entities/pool.entityt';
// import { UNISWAP3_POOL_ABI } from '../../../common/abi/uniswap.abi';
// import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
// import { V3LiquidityUpdaterService } from './liquidity-updater.service';
// import { TOKEN_ALIAS } from '@/ingestion/onchain/common/common-tokens';


// const ERC20_IFACE = new ethers.Interface([
//   'function balanceOf(address) view returns (uint256)'
// ]);

// const MULTICALL_ABI = [
//   'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)'
// ];

// // Example multicall address; replace per chain
// const MULTICALL_ADDRESS: Record<string, string> = {
//   ETH: '0xcA11bde05977b3631167028862bE2a173976CA11',
//   POLYGON: '0x275617327c958bD06b5D6b871E7f491D76113dd',
//   ARBITRUM: '0x842eC2c7D803033Edf55E478F461FC547Bc54EB2'
// };


// @Injectable()
// export class UniswapV3Adapter {

//   private logger = new Logger(UniswapV3Adapter.name);

//   constructor(
//     private readonly ethProvider: EthereumProvider,
//     private readonly aggregationService: AggregationService,
//     private readonly priceCache: PriceCacheService,
//     private readonly liquidity: V3LiquidityUpdaterService,
//   ) {}


//   async normalize(symbol: string) {
//     return TOKEN_ALIAS[symbol] || symbol;
//   }

//   /* =========================
//      INITIAL LIQUIDITY
//   ========================= */
  // async initializePools(pools: DexPool[], chain: string) {
  //   console.log("initializePools",pools.length)
  //   const provider = this.ethProvider.getProvider();
  
  //   const multicall = new ethers.Contract(
  //     MULTICALL_ADDRESS[chain],
  //     MULTICALL_ABI,
  //     provider
  //   );
  
  //   const calls: { target: string; callData: string }[] = [];
  //   const callMap: { pool: DexPool; type: 'token0' | 'token1' }[] = [];
  
  //   // 🔥 Build calls
  //   for (const pool of pools) {
  //     calls.push({
  //       target: pool.token0.address,
  //       callData: ERC20_IFACE.encodeFunctionData('balanceOf', [pool.poolKey]),
  //     });
  //     callMap.push({ pool, type: 'token0' });
  
  //     calls.push({
  //       target: pool.token1.address,
  //       callData: ERC20_IFACE.encodeFunctionData('balanceOf', [pool.poolKey]),
  //     });
  //     callMap.push({ pool, type: 'token1' });
  //   }
  
  //   // 🔥 CHUNKING (VERY IMPORTANT)
  //   const CHUNK_SIZE = 150;
  
  //   for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
  //     const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
  //     const chunkMap = callMap.slice(i, i + CHUNK_SIZE);
  // console.log("CHUNK_SIZE",CHUNK_SIZE)
  //     try {
  //       const [, returnData] = await multicall.aggregate(chunkCalls);
  
  //       for (let j = 0; j < returnData.length; j++) {
  //         const { pool, type } = chunkMap[j];
  
  //         try {
  //           const decoded = ERC20_IFACE.decodeFunctionResult(
  //             'balanceOf',
  //             returnData[j]
  //           );
  
  //           const decimals =
  //             type === 'token0'
  //               ? pool.token0.decimals
  //               : pool.token1.decimals;
  
  //           const amount = Number(
  //             ethers.formatUnits(decoded[0], decimals)
  //           );
  
  //           if (type === 'token0') pool.token0Balance = amount;
  //           else pool.token1Balance = amount;
  
  //         } catch (err) {
  //           console.log("err in initializePools Decode failed for",err)

  //           this.logger.warn(`Decode failed for pool ${pool.poolKey}`);
  //         }
  //       }
  
  //     } catch (err) {
  //       console.log("err in initializePools",err)
  //       this.logger.warn(`Multicall chunk failed at index ${i}`, err);
  //     }
  //   }
  
  //   // 🔥 Compute liquidity + update status
  //   for (const pool of pools) {
  //     await this.liquidity.computeLiquidity(pool);
  //     // ✅ FIX isActive
  //     pool.isActive =
  //       pool.liquidityUsd > 1000 &&
  //       pool.token0Balance > 0 &&
  //       pool.token1Balance > 0;
  //   }
  
  //   this.logger.log(`💧 Initialized ${pools.length} pools`);
  // }



//   /* =========================
//      START LISTENER
//   ========================= */
//   start(pool: DexPool, marketId: number, baseSymbol: string) {
// console.log(" start starting")
//     const provider = this.ethProvider.getProvider();

//     const contract = new ethers.Contract(
//       pool.poolKey,
//       UNISWAP3_POOL_ABI,
//       provider
//     );

//     /* ===== SWAP ===== */
//     contract.on("Swap", async (...args) => {
//       try {
//         // console.log("swapppp",...args)
//         const amount0 = Number(formatUnits(args[2], pool.token0.decimals));
//         const amount1 = Number(formatUnits(args[3], pool.token1.decimals));

//         const sqrtPriceX96 = args[4] as bigint;

//         const price = this.sqrtPriceToPrice(
//           sqrtPriceX96,
//           pool.token0.decimals,
//           pool.token1.decimals
//         );      
//           const usdPrice = this.normalizeToUSD(price, pool);

//         if (!usdPrice) return;


//                 let baseVolume: number;

//                 if (pool.token0.canonicalSymbol == baseSymbol) {
//                   baseVolume = Math.abs(amount0);
//                 } else if (pool.token1.canonicalSymbol == baseSymbol) {
//                   baseVolume = Math.abs(amount1);

//                 } else {
//                   console.log("ssss",marketId,pool.token0.canonicalSymbol ,baseSymbol)
//                   this.logger.warn("Base mismatch"
//                   ,pool.token0.canonicalSymbol ,baseSymbol,pool.poolKey);
//                   return;
//                 }





// console.log("amounts",args[2],args[3],amount0,amount1,pool.poolKey)
//         // ✅ Candle update
//         this.aggregationService.handleLiveCandle(
//           marketId,
//          Exchange.UNISWAP_V3,
//           {
//             exchange:     Exchange.UNISWAP_V3,
//             openTime: Date.now(),
//             open: usdPrice,
//             high: usdPrice,
//             low: usdPrice,
//             close: usdPrice,
//             volume:baseVolume,
//             quote: 'USD',
//             isFinal: false,
//           }
//         );
//         pool.lastSwapAt = Date.now();
//         pool.volume24h += Math.abs(baseVolume);

//         pool.score = 
//           Number(pool.liquidityUsd || 0) * 0.7 +
//           Number(pool.volume24h || 0) * 0.3
//         ;

//         // ✅ Liquidity update
//         await this.liquidity.updateFromSwap(pool, amount0, amount1);

//       } catch (err) {
//         this.logger.error(`Swap error ${pool.poolKey}`, err);
//       }
//     });

//     /* ===== MINT ===== */
//     contract.on("Mint", async (...args) => {
//       try {
//         console.log("mint",...args)
//         const amount0 = Number(args[5]);
//         const amount1 = Number(args[6]);

//         await this.liquidity.updateFromMint(pool, amount0, amount1);

//       } catch (err) {
//         this.logger.error(`Mint error ${pool.poolKey}`, err);
//       }
//     });

//     /* ===== BURN ===== */
//     contract.on("Burn", async (...args) => {
//       try {
//                 console.log("mint",...args)

//         const amount0 = Number(args[4]);
//         const amount1 = Number(args[5]);

//         await this.liquidity.updateFromBurn(pool, amount0, amount1);

//       } catch (err) {
//         this.logger.error(`Burn error ${pool.poolKey}`, err);
//       }
//     });

//     this.logger.log(`👂 Listening ${pool.poolKey}`);
//   }

//   /* =========================
//      PRICE UTILS
//   ========================= */

//   private sqrtPriceToPrice(
//     sqrtPriceX96: bigint,
//     decimals0: number,
//     decimals1: number
//   ): number {
  
//     const ratio = Number(sqrtPriceX96) / 2 ** 96;
//     const price = ratio * ratio;
  
//     // 🔥 adjust decimals
//     return price * (10 ** (decimals0 - decimals1));
//   }

//   private normalizeToUSD(price: number, pool: DexPool): number | null {

//     const t0 = pool.token0.canonicalSymbol;
//     const t1 = pool.token1.canonicalSymbol;
  
//     const p0 = this.priceCache.getPrice(t0);
//     const p1 = this.priceCache.getPrice(t1);
  
//     // token1 is priced → price is token0/token1
//     if (p1) return price * p1;
  
//     // token0 is priced → invert
//     if (p0) return (1 / price) * p0;
  
//     return null;
//   }
// }





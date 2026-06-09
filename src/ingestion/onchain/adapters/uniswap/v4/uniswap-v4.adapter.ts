// ============================================================
// uniswap-v4.adapter.ts
//
// Singleton PoolManager listener handles ALL V4 pools on a chain.
// Each pool maps to multiple markets via dex_market_maps.baseIsToken0.
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { DexPool } from '../../../common/entities/pool.entityt';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
import { Exchange } from '@/common/enums/exchanges.enums';
import { SharedLiquidityService } from '../base/shared-liquidity.service';
import { OnchainUtil } from '@/ingestion/onchain/common/onchain.utils';
import { KafkaService } from '@/common-module/kafka/kafka.service';
import { Chain, CHAIN_CONFIGS } from '@/ingestion/onchain/common/chain.config';
import { PoolMarketMapping } from '../base/dex-adapter.interface';

const POOL_MANAGER_ABI = [
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
];

@Injectable()
export class UniswapV4Adapter {
  private readonly logger = new Logger(UniswapV4Adapter.name);

  // `${chainId}:${poolKey}` → { pool, mappings[] }
  private poolMap     = new Map<string, { pool: DexPool; mappings: PoolMarketMapping[] }>();
  private startedChains = new Set<Chain>();

  constructor(
    private readonly priceCache: PriceCacheService,
    private readonly liquidity:  SharedLiquidityService,
    private readonly kafka:      KafkaService,
  ) {}

  register(chainId: Chain, pool: DexPool, mappings: PoolMarketMapping[]) {
    this.poolMap.set(`${chainId}:${pool.poolKey}`, { pool, mappings });
  }

  isRegistered(chainId: Chain, poolKey: string): boolean {
    return this.poolMap.has(`${chainId}:${poolKey}`);
  }

  async initializePools(pools: DexPool[], _chainId: Chain) {
    if (pools.length) await this.liquidity.initializePools(pools);
  }

  start(chainId: Chain, provider: ethers.WebSocketProvider) {
    if (this.startedChains.has(chainId)) return;
    this.startedChains.add(chainId);

    const config   = CHAIN_CONFIGS[chainId];
    const contract = new ethers.Contract(
      config.uniswapV4PoolManager,
      POOL_MANAGER_ABI,
      provider,
    );

    // ── SWAP ─────────────────────────────────────────────────────
    contract.on("Swap", async (poolId, _sender, a0Raw, a1Raw, sqrtPriceX96) => {
      const entry = this.poolMap.get(`${chainId}:${poolId}`);
      if (!entry) return;
      const { pool, mappings } = entry;
      if (!mappings.length) return;

      try {
        const amount0 = Number(ethers.formatUnits(a0Raw, pool.token0.decimals));
        const amount1 = Number(ethers.formatUnits(a1Raw, pool.token1.decimals));
        const price = OnchainUtil.sqrtPriceToPrice(
          sqrtPriceX96,
          pool.token0.decimals,
          pool.token1.decimals,
        );
        if (!price || price <= 0) return;

        // Publish to ALL markets this pool serves
        for (const m of mappings) {
          const usdPrice = OnchainUtil.normalizeToUSD(price, pool, this.priceCache, m.baseIsToken0);
          if (!usdPrice || usdPrice <= 0) continue;

          const baseVolume = m.baseIsToken0 ? Math.abs(amount0) : Math.abs(amount1);
console.log("kafkaaaaaaaaaaaa v4")

          this.kafka.publishDexSwap({
            marketId:   m.marketId,
            exchange:   Exchange.UNISWAP_V4,
            priceUsd:   usdPrice,
            baseVolume,
            openTime:   Date.now(),
          }).catch(err => this.logger.error('Kafka publish failed', err));
        }

        // Pool-level stats
        const first = mappings[0];
        const displayPrice = OnchainUtil.normalizeToUSD(price, pool, this.priceCache, first.baseIsToken0);
        if (displayPrice) pool.price = displayPrice;

        pool.volume24h  = (pool.volume24h ?? 0) + Math.abs(amount0);
        pool.score      = (pool.liquidityUsd ?? 0) * 0.7 + (pool.volume24h ?? 0) * 0.3;
        pool.lastSwapAt = Date.now();

        await this.liquidity.updateV4FromSwap(pool, amount0, amount1);

      } catch (err) {
        this.logger.error(`${config.name} Swap error ${poolId}`, err);
      }
    });

    // ── MODIFY LIQUIDITY ─────────────────────────────────────────
    contract.on("ModifyLiquidity", async (poolId) => {
      const entry = this.poolMap.get(`${chainId}:${poolId}`);
      if (!entry) return;
      this.liquidity.scheduleV4Refresh(entry.pool);
    });

    const count = [...this.poolMap.keys()].filter(k => k.startsWith(`${chainId}:`)).length;
    this.logger.log(`👂 ${config.name} V4 started — ${count} pools`);
  }
}




// //without multichain
// @Injectable()
// export class UniswapV4Adapter {

//   private logger = new Logger(UniswapV4Adapter.name);
//   private poolMap = new Map<string, { pool: DexPool; marketIds: number[] }>();
//   private started = false;

//   constructor(
//     private readonly provider: EthereumProvider,
//     private readonly aggregation: AggregationService,
//     private readonly priceCache: PriceCacheService,
//     private readonly liquidity: SharedLiquidityService,
//     private readonly kafka:      KafkaService,

//   ) { }

//   // ── Registration ─────────────────────────────────────────────
//   register(pool: DexPool, markets: number[]) {
//     this.poolMap.set(pool.poolKey, { pool, marketIds: markets });
//   }

//   isRegistered(poolKey: string): boolean {
//     return this.poolMap.has(poolKey);
//   }

//   // ── Balance init (subgraph for V4) ───────────────────────────
//   async initializePools(pools?: DexPool[]) {
//     console.log("initialize poolsssss", pools?.length)
//     const target = pools ?? [...this.poolMap.values()].map(e => e.pool);
//     if (target.length) await this.liquidity.initializePools(target);
//   }

//   // ── Singleton PoolManager event listener ─────────────────────
//   start() {
//     if (this.started) return;
//     this.started = true;

//     const contract = new ethers.Contract(
//       process.env.UNISWAP_V4_POOL_MANAGER!,
//       POOL_MANAGER_ABI,
//       this.provider.getProvider()
//     );

//     // ── SWAP ─────────────────────────────────────────────────────
//     // event args: id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee
//     contract.on("Swap", async (poolId, _sender, a0Raw, a1Raw, sqrtPriceX96) => {
//       console.log("swapppp", poolId, _sender, a0Raw, a1Raw, sqrtPriceX96)
//       const entry = this.poolMap.get(poolId);
//       console.log("entry swap", entry)
//       if (!entry) return;

//       const { pool, marketIds } = entry;

//       try {
//         // ✅ Format raw int128 amounts from the event
//         const amount0 = Number(ethers.formatUnits(a0Raw, pool.token0.decimals));
//         const amount1 = Number(ethers.formatUnits(a1Raw, pool.token1.decimals));

//         // ✅ Price from sqrtPriceX96 — this is the post-swap price, correct for candles
//         const price = OnchainUtil.sqrtPriceToPrice(
//           sqrtPriceX96,
//           pool.token0.decimals,
//           pool.token1.decimals
//         );
//         if (!price || price <= 0) return;

//        let   usdPrice = OnchainUtil.normalizeToUSD(price, pool, this.priceCache)
//           console.log("swap v4", usdPrice)
//           if (!usdPrice || usdPrice <= 0) return;

//           pool.price = usdPrice;
        
//         // Volume = base token amount (whichever side is not the quote)
//         const baseIsToken0 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();
//         const baseVolume = baseIsToken0 ? Math.abs(amount0) : Math.abs(amount1);

//         for (const marketId of marketIds) {
//           this.kafka.publishDexSwap({
//             marketId,
//             exchange:   Exchange.UNISWAP_V4,
//             priceUsd:   usdPrice,
//             baseVolume,
//             openTime:   Date.now(),
//           }).catch(err => this.logger.error('Kafka publish failed', err));
//         }

//         pool.volume24h = (pool.volume24h ?? 0) + baseVolume;
//         pool.score = (pool.liquidityUsd ?? 0) * 0.7 + (pool.volume24h ?? 0) * 0.3;

//         // ✅ TVL delta tracking: pasxxs amount0/amount1 (not sqrtPriceX96/liquidity)
//         // Swap does not change total pool TVL — only the ratio changes.
//         // Delta tracking with event amounts is exact for swaps.
//         await this.liquidity.updateV4FromSwap(pool, amount0, amount1);

//       } catch (err) {
//         this.logger.error(`Swap error poolId=${poolId}`, err);
//       }
//     });

//     // ── MODIFY LIQUIDITY ─────────────────────────────────────────
//     // LP add or remove — changes total pool TVL.
//     // Event has no token amounts, so we can't delta-track.
//     // Schedule a subgraph re-sync for this specific pool after 60s.
//     contract.on("ModifyLiquidity", async (poolId) => {
//       console.log("ModifyLiquidity", poolId)
//       const entry = this.poolMap.get(poolId);
//       console.log("entryyy", entry)
//       if (!entry) return;
//       // Debounced: rapid LP activity only triggers one re-sync
//       this.liquidity.scheduleV4Refresh(entry.pool);
//     });

//     this.logger.log(`👂 V4 started — ${this.poolMap.size} pools registered`);
//   }



// }















/* for all  pool balance */
// // ============================================================
// // uniswap-v4.adapter.ts
// // ============================================================
// import { Injectable, Logger } from '@nestjs/common';
// import { ethers } from 'ethers';
// import { AggregationService } from '@/aggregation/aggregation.service';
// import { EthereumProvider } from '../../../providers/ethereum.provider';
// import { DexPool } from '../../../common/entities/pool.entityt';
// import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
// import { Exchange } from '@/common/enums/exchanges.enums';
// import { SharedLiquidityService } from '../base/shared-liquidity.service';
// import { canonicalSymbol } from '../base/pool-filter';

// const POOL_MANAGER_ABI = [
//   // Full signature — liquidity param is used for real-time TVL update
//   "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
//   "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
// ];

// @Injectable()
// export class UniswapV4Adapter {

//   private logger  = new Logger(UniswapV4Adapter.name);
//   private poolMap = new Map<string, { pool: DexPool; marketIds: number[] }>();
//   private started = false;

//   constructor(
//     private readonly provider:    EthereumProvider,
//     private readonly aggregation: AggregationService,
//     private readonly priceCache:  PriceCacheService,
//     private readonly liquidity:   SharedLiquidityService,
//   ) {}

//   // ── Registration ─────────────────────────────────────────────
//   register(pool: DexPool, markets: number[]) {
//     this.poolMap.set(pool.poolKey, { pool, marketIds: markets });
//   }

//   isRegistered(poolKey: string): boolean {
//     return this.poolMap.has(poolKey);
//   }

//   // ── Init balances for a set of pools (or all registered) ─────
//   async initializePools(pools?: DexPool[]) {
//     const target = pools ?? [...this.poolMap.values()].map(e => e.pool);
//     if (target.length) await this.liquidity.initializePools(target);
//   }

//   // ── Singleton event listener ──────────────────────────────────
//   start() {
//     if (this.started) return; // idempotent
//     this.started = true;

//     const contract = new ethers.Contract(
//       process.env.UNISWAP_V4_POOL_MANAGER!,
//       POOL_MANAGER_ABI,
//       this.provider.getProvider()
//     );

//     // ── SWAP ───────────────────────────────────────────────────
//     // args: id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee
//     contract.on("Swap", async (poolId, _sender, a0Raw, a1Raw, sqrtPriceX96, liquidity) => {
//       const entry = this.poolMap.get(poolId);
//       if (!entry) return; // pool not tracked

//       const { pool, marketIds } = entry;

//       try {
//         // ✅ formatUnits here — raw int128 from chain
//         const amount0 = Number(ethers.formatUnits(a0Raw, pool.token0.decimals));
//         const amount1 = Number(ethers.formatUnits(a1Raw, pool.token1.decimals));

//         // USD price from sqrtPriceX96
//         const price    = this.sqrtPriceToPrice(sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
//         const usdPrice = this.normalizeToUSD(price, pool);
//         if (!usdPrice || usdPrice <= 0) return;

//         // Volume: base token is whichever side is NOT the quote
//         const baseIsToken0 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();
//         const baseVolume   = baseIsToken0 ? Math.abs(amount0) : Math.abs(amount1);

//         // Emit candle to aggregation layer
//         for (const marketId of marketIds) {
//           this.aggregation.handleLiveCandle(marketId, Exchange.UNISWAP_V4, {
//             exchange: Exchange.UNISWAP_V4,
//             openTime: Date.now(),
//             open:  usdPrice,
//             high:  usdPrice,
//             low:   usdPrice,
//             close: usdPrice,
//             volume: baseVolume,
//             quote: 'USD',
//             isFinal: false,
//           });
//         }

//         // Update pool stats in memory
//         pool.volume24h = (pool.volume24h ?? 0) + baseVolume;
//         pool.score     = (pool.liquidityUsd ?? 0) * 0.7 + (pool.volume24h ?? 0) * 0.3;

//         // ✅ Recompute TVL from event data + save to DB
//         // Uses virtual in-range amounts from sqrtPriceX96 + liquidity.
//         // Full PoolManager balance re-read happens on ModifyLiquidity.
//         // await this.liquidity.initializePools(pool, sqrtPriceX96, liquidity);

//       } catch (err) {
//         this.logger.error(`Swap error poolId=${poolId}`, err);
//       }
//     });

//     // ── MODIFY LIQUIDITY ───────────────────────────────────────
//     // No token amounts in this event.
//     // Schedule a debounced PoolManager balance re-read (30s).
//     contract.on("ModifyLiquidity", async (poolId) => {
//       const entry = this.poolMap.get(poolId);
//       if (!entry) return;
//       this.liquidity.scheduleV4Refresh(entry.pool);
//     });

//     this.logger.log(`👂 V4 started — ${this.poolMap.size} pools registered`);
//   }

//   // ── Price utils ───────────────────────────────────────────────

//   // sqrtPriceX96 → token0/token1 ratio in human-readable terms
//   private sqrtPriceToPrice(sqrt: bigint, d0: number, d1: number): number {
//     const ratio = Number(sqrt) / 2 ** 96;
//     return (ratio * ratio) * (10 ** (d0 - d1));
//   }

//   // Convert pool ratio → USD using priceCache + quoteTokenAddress
//   private normalizeToUSD(price: number, pool: DexPool): number | null {
//     const sym0 = canonicalSymbol(pool.token0);
//     const sym1 = canonicalSymbol(pool.token1);
//     const p0   = this.priceCache.getPrice(sym0);
//     const p1   = this.priceCache.getPrice(sym1);

//     // quoteTokenAddress tells us which side is the price denominator
//     const quoteIsToken1 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();

//     if (quoteIsToken1 && p1 != null) return price * p1;       // TOKEN/USDC → price * 1
//     if (!quoteIsToken1 && p0 != null) return (1 / price) * p0; // USDC/TOKEN → invert
//     return null;
//   }
// }
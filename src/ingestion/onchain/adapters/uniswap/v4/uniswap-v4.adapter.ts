// ============================================================
// uniswap-v4.adapter.ts
//
// Singleton adapter that handles Swap/ModifyLiquidity for
// ALL V4 chains. One PoolManager contract listener per chain.
//
// poolMap key: `${chainId}:${poolKey}` — prevents ETH pools
// from colliding with ARB pools that share the same poolKey.
//
// start(chainId, provider) is idempotent — safe to call
// multiple times (guarded by startedChains Set).
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { EthereumProvider } from '../../../providers/ethereum.provider';
import { DexPool } from '../../../common/entities/pool.entityt';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
import { Exchange } from '@/common/enums/exchanges.enums';
import { canonicalSymbol } from '../base/pool-filter';
import { SharedLiquidityService } from '../base/shared-liquidity.service';
import { OnchainUtil } from '@/ingestion/onchain/common/onchain.utils';
import { KafkaService } from '@/common-module/kafka/kafka.service';
import { Chain, CHAIN_CONFIGS } from '@/ingestion/onchain/common/chain.config';

const POOL_MANAGER_ABI = [
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
];

@Injectable()
export class UniswapV4Adapter {
  private readonly logger = new Logger(UniswapV4Adapter.name);

  // `${chainId}:${poolKey}` → { pool, marketIds }
  private poolMap = new Map<string, { pool: DexPool; marketIds: number[] }>();

  // Chains that already have a listener started
  private startedChains = new Set<Chain>();

  constructor(
    private readonly priceCache: PriceCacheService,
    private readonly liquidity:  SharedLiquidityService,
    private readonly kafka:      KafkaService,
  ) {}

  // ── Registration (called by V4OnchainService.registerPools) ──
  register(chainId: Chain, pool: DexPool, marketIds: number[]) {
    const key = this.key(chainId, pool.poolKey);
    this.poolMap.set(key, { pool, marketIds });
  }

  isRegistered(chainId: Chain, poolKey: string): boolean {
    return this.poolMap.has(this.key(chainId, poolKey));
  }

  // ── Initialize balances for pools (subgraph TVL + StateView) ─
  async initializePools(pools: DexPool[], chainId: Chain) {
    if (!pools.length) return;
    // SharedLiquidityService routes by pool.dex and uses pool.chainId
    // for chain-specific subgraph ID and StateView address
    await this.liquidity.initializePools(pools);
  }

  // ── Start singleton PoolManager listener for one chain ────────
  start(chainId: Chain, provider: ethers.WebSocketProvider) {
    if (this.startedChains.has(chainId)) return; // idempotent
    this.startedChains.add(chainId);

    const config   = CHAIN_CONFIGS[chainId];
    const contract = new ethers.Contract(
      config.uniswapV4PoolManager,
      POOL_MANAGER_ABI,
      provider
    );

    // ── SWAP ───────────────────────────────────────────────────
    contract.on("Swap", async (poolId, _sender, a0Raw, a1Raw, sqrtPriceX96) => {
      const entry = this.poolMap.get(this.key(chainId, poolId));
      if (!entry) return;

      const { pool, marketIds } = entry;

      try {
        const amount0 = Number(ethers.formatUnits(a0Raw, pool.token0.decimals));
        const amount1 = Number(ethers.formatUnits(a1Raw, pool.token1.decimals));

        const price = OnchainUtil.sqrtPriceToPrice(
          sqrtPriceX96,
          pool.token0.decimals,
          pool.token1.decimals
        );
        if (!price || price <= 0) return;

        const usdPrice = OnchainUtil.normalizeToUSD(price, pool, this.priceCache);
        if (!usdPrice || usdPrice <= 0) return;

        pool.price = usdPrice;

        const baseIsToken0 = pool.quoteTokenAddress === pool.token1.address.toLowerCase();
        const baseVolume   = baseIsToken0 ? Math.abs(amount0) : Math.abs(amount1);

        // Publish to Kafka — consumer aggregates with CEX ticks
        for (const marketId of marketIds) {
          this.kafka.publishDexSwap({
            marketId,
            exchange:   Exchange.UNISWAP_V4,
            priceUsd:   usdPrice,
            baseVolume,
            openTime:   Date.now(),
          }).catch(err => this.logger.error(`${config.name} Kafka publish failed`, err));
        }

        pool.volume24h = (pool.volume24h ?? 0) + baseVolume;
        pool.score     = (pool.liquidityUsd ?? 0) * 0.7 + (pool.volume24h ?? 0) * 0.3;

        // Delta TVL tracking — swap doesn't change total TVL, only ratio
        await this.liquidity.updateV4FromSwap(pool, amount0, amount1);

      } catch (err) {
        this.logger.error(`${config.name} Swap error poolId=${poolId}`, err);
      }
    });

    // ── MODIFY LIQUIDITY ───────────────────────────────────────
    // LP add/remove — schedules subgraph re-sync after 60s debounce
    contract.on("ModifyLiquidity", async (poolId) => {
      const entry = this.poolMap.get(this.key(chainId, poolId));
      if (!entry) return;
      this.liquidity.scheduleV4Refresh(entry.pool);
    });

    // Count registered pools for this chain
    const chainPools = [...this.poolMap.keys()]
      .filter(k => k.startsWith(`${chainId}:`)).length;

    this.logger.log(
      `👂 ${config.name} V4 adapter started — ${chainPools} pools registered`
    );
  }

  // ── Helpers ────────────────────────────────────────────────────
  private key(chainId: Chain, poolKey: string): string {
    return `${chainId}:${poolKey}`;
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
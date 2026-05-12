// ============================================================
// shared-liquidity.service.ts
//
// V3 → multicall balanceOf(poolAddress) + slot0()    per-pool exact
// V4 → subgraph totalValueLockedToken0/1             exact TVL
//    → StateView.getSlot0(poolId) via multicall      startup price
//    → Swap event delta amount0/amount1              real-time TVL
//    → subgraph re-sync on ModifyLiquidity           LP change reconcile
//
// MULTICHAIN: uses pool.chainId to select correct subgraph ID,
// StateView address, and Multicall3 address from CHAIN_CONFIGS.
// ============================================================
import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DexPool } from "../../../common/entities/pool.entityt";
import { EthereumProvider } from "../../../providers/ethereum.provider";
import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
import { DexType, CHAIN_CONFIGS, Chain } from "../../../common/chain.config";
import { OnchainUtil } from "@/ingestion/onchain/common/onchain.utils";
import { DexAutoMapperService } from "@/ingestion/onchain/common/ingestion-cron/token-syncing/dex-auto-mapper.service";
import { ChainProviderFactory } from "../../../providers/provider.factory";

// ── Shared ABIs ─────────────────────────────────────────────
const ERC20_IFACE = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
]);

const V3_SLOT0_IFACE = new ethers.Interface([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
]);

const V4_STATE_VIEW_IFACE = new ethers.Interface([
  "function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const MULTICALL_ABI = [
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

const CHUNK_SIZE = 100;

// Fallback Multicall3 — same address on every EVM chain
const FALLBACK_MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
// Fallback V4 StateView (Ethereum mainnet)
const FALLBACK_STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";

@Injectable()
export class SharedLiquidityService {
  private readonly logger = new Logger(SharedLiquidityService.name);

  constructor(
    private readonly provider:    EthereumProvider,
    private readonly chains:      ChainProviderFactory,
    private readonly priceCache:  PriceCacheService,
    private readonly autoMapper:  DexAutoMapperService,
    @InjectRepository(DexPool) private poolRepo: Repository<DexPool>,
  ) {}

  // ── Entry point: routes by DEX type ──────────────────────────
  async initializePools(pools: DexPool[]) {
    if (!pools.length) return;

    const v3 = pools.filter(p => p.dex === DexType.UNISWAP_V3);
    const v4 = pools.filter(p => p.dex === DexType.UNISWAP_V4);

    if (v3.length) await this.initV3Pools(v3);
    if (v4.length) await this.initV4Pools(v4);
  }

  // ── V3: multicall balanceOf + slot0 per pool contract ─────────
  private async initV3Pools(pools: DexPool[]) {
    // Group by chainId — each chain needs its own provider + multicall
    const byChain = this.groupByChain(pools);

    for (const [chainId, chainPools] of byChain) {
      await this.initV3ForChain(chainId, chainPools);
    }
  }

  private async initV3ForChain(chainId: Chain, pools: DexPool[]) {
    const config   = CHAIN_CONFIGS[chainId];
    const provider = this.chains.get(chainId) ?? this.provider.getProvider();
    const multicall = new ethers.Contract(
      config?.multicall ?? FALLBACK_MULTICALL,
      MULTICALL_ABI,
      provider
    );

    const calls:   { target: string; callData: string }[] = [];
    const callMap: { pool: DexPool; side: "token0" | "token1" | "slot0" }[] = [];

    for (const pool of pools) {
      calls.push({ target: pool.token0.address, callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]) });
      callMap.push({ pool, side: "token0" });

      calls.push({ target: pool.token1.address, callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]) });
      callMap.push({ pool, side: "token1" });

      calls.push({ target: pool.poolKey, callData: V3_SLOT0_IFACE.encodeFunctionData("slot0") });
      callMap.push({ pool, side: "slot0" });
    }

    await this.runMulticall(multicall, calls, callMap);

    for (const pool of pools) {
      this.computeLiquidity(pool);
      pool.isActive      = OnchainUtil.isActivePool(pool);
      pool.isInitialized = true;
    }

    await this.poolRepo.save(pools);

    this.logger.log(
      `💧 V3 [${config?.name ?? chainId}]: ${pools.length} pools — ` +
      `${pools.filter(p => p.isActive).length} active`
    );
  }

  // ── V4: subgraph TVL + StateView price ───────────────────────
  private async initV4Pools(pools: DexPool[]) {
    // Group by chainId — each chain has its own subgraph
    const byChain = this.groupByChain(pools);

    for (const [chainId, chainPools] of byChain) {
      await this.initV4ForChain(chainId, chainPools);
    }
  }

  private async initV4ForChain(chainId: Chain, pools: DexPool[]) {
    const config = CHAIN_CONFIGS[chainId];

    // TVL from subgraph (chain-specific subgraph ID)
    await this.fetchTVLFromSubgraph(pools, chainId);

    // Startup price from StateView (chain-specific address)
    await this.fetchV4StartupPrices(pools, chainId);

    await this.poolRepo.save(pools);
    await this.autoMapper.mapPoolsV4(pools);

    this.logger.log(
      `💧 V4 [${config?.name ?? chainId}]: ${pools.filter(p => p.isInitialized).length} pools — ` +
      `${pools.filter(p => p.isActive).length} active`
    );
  }

  // ── V4 StateView price fetch ──────────────────────────────────
  private async fetchV4StartupPrices(pools: DexPool[], chainId: Chain) {
    const config      = CHAIN_CONFIGS[chainId];
    const provider    = this.chains.get(chainId) ?? this.provider.getProvider();
    const multicall   = new ethers.Contract(config?.multicall ?? FALLBACK_MULTICALL, MULTICALL_ABI, provider);
    const stateView   = config?.stateView ?? FALLBACK_STATE_VIEW;

    const slot0Calls = pools.map(pool => ({
      target:   stateView,
      callData: V4_STATE_VIEW_IFACE.encodeFunctionData("getSlot0", [pool.poolKey]),
    }));

    for (let i = 0; i < slot0Calls.length; i += CHUNK_SIZE) {
      try {
        const results: { success: boolean; returnData: string }[] =
          await multicall.tryAggregate.staticCall(false, slot0Calls.slice(i, i + CHUNK_SIZE));

        for (let j = 0; j < results.length; j++) {
          const { success, returnData } = results[j];
          if (!success || returnData === "0x") continue;

          try {
            const [sqrtPriceX96] = V4_STATE_VIEW_IFACE.decodeFunctionResult("getSlot0", returnData);
            const pool = pools[i + j];
            if (!sqrtPriceX96 || sqrtPriceX96 === 0n) continue;

            const price = OnchainUtil.sqrtPriceToPrice(sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
            if (price != null) OnchainUtil.applyPrice(pool, price, this.priceCache);
          } catch {
            this.logger.warn(`V4 getSlot0 decode failed pool=${pools[i + j].poolKey}`);
          }
        }
      } catch (err) {
        this.logger.error(`[${config?.name ?? chainId}] V4 StateView chunk failed i=${i}`, err);
      }
    }
  }

  // ── V4 TVL from The Graph subgraph ────────────────────────────
  private async fetchTVLFromSubgraph(pools: DexPool[], chainId: Chain) {
    const config   = CHAIN_CONFIGS[chainId];
    const subgraphId = config?.subgraphV4Id;
    const apiKey   = process.env.GRAPH_API_KEY;

    if (!apiKey || !subgraphId || subgraphId.includes('_SUBGRAPH_ID')) {
      this.logger.warn(
        `[${config?.name ?? chainId}] V4 subgraph not configured — ` +
        "pools will init with 0 balance. Set GRAPH_API_KEY and subgraphV4Id."
      );
      for (const pool of pools) {
        pool.isInitialized = true;
        pool.isActive      = false;
      }
      return;
    }

    const SUBGRAPH_URL = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;

    for (let i = 0; i < pools.length; i += CHUNK_SIZE) {
      const batch = pools.slice(i, i + CHUNK_SIZE);
      const ids   = batch.map(p => `"${p.poolKey.toLowerCase()}"`).join(",");

      const query = `{
        pools(where: { id_in: [${ids}] }) {
          id
          totalValueLockedToken0
          totalValueLockedToken1
        }
      }`;

      try {
        const res  = await fetch(SUBGRAPH_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ query }),
        });
        const json = await res.json();

        if (json.errors) {
          this.logger.error(`[${config?.name ?? chainId}] Subgraph error: ${JSON.stringify(json.errors)}`);
          continue;
        }

        const byId = new Map<string, any>();
        for (const p of (json.data?.pools ?? [])) byId.set(p.id.toLowerCase(), p);

        for (const pool of batch) {
          const data = byId.get(pool.poolKey.toLowerCase());
          pool.isInitialized = true;

          if (!data) {
            pool.isActive = false;
            continue;
          }

          pool.token0Balance = parseFloat(data.totalValueLockedToken0) || 0;
          pool.token1Balance = parseFloat(data.totalValueLockedToken1) || 0;

          const priceOk  = this.computeLiquidity(pool);
          pool.isActive  =
            pool.token0Balance > 0 &&
            pool.token1Balance > 0 &&
            (pool.liquidityUsd > 1000 || !priceOk);
        }

      } catch (err) {
        this.logger.error(`[${config?.name ?? chainId}] Subgraph fetch failed i=${i}`, err);
        batch.forEach(p => { p.isInitialized = true; });
      }
    }
  }

  // ── Compute USD liquidity ─────────────────────────────────────
  computeLiquidity(pool: DexPool): boolean {
    const ok = OnchainUtil.computeLiquidityUsd(pool, this.priceCache);
    if (!ok) {
      this.logger.debug(
        `No price for ${pool.token0.symbol}/${pool.token1.symbol} ` +
        `[${CHAIN_CONFIGS[pool.chainId]?.name ?? pool.chainId}]`
      );
    }
    return ok;
  }

  // ── V4 swap delta tracking ────────────────────────────────────
  async updateV4FromSwap(pool: DexPool, amount0: number, amount1: number) {
    pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
    pool.token1Balance = Math.max(0, pool.token1Balance + amount1);
    this.computeLiquidity(pool);
    pool.isActive   = pool.liquidityUsd > 1000;
    pool.lastSwapAt = Date.now();
    await this.poolRepo.save(pool);
  }

  // ── V3 swap / mint / burn delta ───────────────────────────────
  async updateFromSwap(pool: DexPool, amount0: number, amount1: number) {
    pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
    pool.token1Balance = Math.max(0, pool.token1Balance + amount1);
    this.computeLiquidity(pool);
    pool.isActive   = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
    pool.lastSwapAt = Date.now();
    await this.poolRepo.save(pool);
  }

  async updateFromMint(pool: DexPool, amount0: number, amount1: number) {
    pool.token0Balance += Math.abs(amount0);
    pool.token1Balance += Math.abs(amount1);
    this.computeLiquidity(pool);
    await this.poolRepo.save(pool);
  }

  async updateFromBurn(pool: DexPool, amount0: number, amount1: number) {
    pool.token0Balance = Math.max(0, pool.token0Balance - Math.abs(amount0));
    pool.token1Balance = Math.max(0, pool.token1Balance - Math.abs(amount1));
    this.computeLiquidity(pool);
    await this.poolRepo.save(pool);
  }

  // ── V4 ModifyLiquidity: debounced subgraph re-sync ───────────
  private refreshTimers = new Map<string, NodeJS.Timeout>();

  scheduleV4Refresh(pool: DexPool) {
    if (this.refreshTimers.has(pool.poolKey)) return;

    const timer = setTimeout(async () => {
      await this.fetchTVLFromSubgraph([pool], pool.chainId as Chain);
      await this.fetchV4StartupPrices([pool], pool.chainId as Chain);
      await this.poolRepo.save([pool]);
      await this.autoMapper.mapPoolsV4([pool]);
      this.refreshTimers.delete(pool.poolKey);
    }, 60_000);

    this.refreshTimers.set(pool.poolKey, timer);
  }

  // ── Helpers ───────────────────────────────────────────────────
  private groupByChain(pools: DexPool[]): Map<Chain, DexPool[]> {
    const map = new Map<Chain, DexPool[]>();
    for (const pool of pools) {
      const chainId = pool.chainId as Chain;
      if (!map.has(chainId)) map.set(chainId, []);
      map.get(chainId)!.push(pool);
    }
    return map;
  }

  private async runMulticall(
    multicall: ethers.Contract,
    calls:     { target: string; callData: string }[],
    callMap:   { pool: DexPool; side: "token0" | "token1" | "slot0" }[],
  ) {
    for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
      const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
      const chunkMap   = callMap.slice(i, i + CHUNK_SIZE);

      try {
        const results: { success: boolean; returnData: string }[] =
          await multicall.tryAggregate.staticCall(false, chunkCalls);

        for (let j = 0; j < results.length; j++) {
          const { success, returnData } = results[j];
          const { pool, side } = chunkMap[j];
          if (!success || returnData === "0x") continue;

          try {
            if (side === "slot0") {
              const [sqrtPriceX96] = V3_SLOT0_IFACE.decodeFunctionResult("slot0", returnData);
              const price = OnchainUtil.sqrtPriceToPrice(sqrtPriceX96, pool.token0.decimals, pool.token1.decimals);
              if (price != null) OnchainUtil.applyPrice(pool, price, this.priceCache);
              continue; // slot0 done — don't fall through to balanceOf decode
            }

            const [raw]    = ERC20_IFACE.decodeFunctionResult("balanceOf", returnData);
            const decimals = side === "token0" ? pool.token0.decimals : pool.token1.decimals;
            const amount   = Number(ethers.formatUnits(raw, decimals));

            if (side === "token0") pool.token0Balance = amount;
            if (side === "token1") pool.token1Balance = amount;

          } catch {
            this.logger.warn(`Decode failed pool=${pool.poolKey} side=${side}`);
          }
        }
      } catch (err) {
        this.logger.error(`Multicall chunk failed i=${i}`, err);
      }
    }
  }
}















/*without multichain  */

// // ── Constants ────────────────────────────────────────────────
// const CHUNK_SIZE        = 100;
// const MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
// const DEFAULT_STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";

// // ✅ CORRECT Uniswap V4 mainnet subgraph ID
// // DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G was V2 — that's why `pools` field was missing
// const V4_SUBGRAPH_ID = "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";

// // ── ABIs ─────────────────────────────────────────────────────
// const ERC20_ABI   = ["function balanceOf(address) view returns (uint256)"];
// const ERC20_IFACE = new ethers.Interface(ERC20_ABI);
// const V3_IFACE = new ethers.Interface([
//   "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"
// ]);
// // V4: slot0 lives on StateView contract, takes poolId (bytes32)
// const V4_STATE_VIEW_IFACE = new ethers.Interface([
//   "function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
// ]);
// const MULTICALL_ABI = [
//   "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
// ];

// @Injectable()
// export class SharedLiquidityService {
//   private logger = new Logger(SharedLiquidityService.name);

//   constructor(
//     private readonly provider:   EthereumProvider,
//     private readonly priceCache: PriceCacheService,
//     @InjectRepository(DexPool) private poolRepo: Repository<DexPool>,
//     private readonly autoMapper: DexAutoMapperService,

//   ) {}

//   // ============================================================
//   // ENTRY POINT — routes V3 and V4 to correct strategy
//   // ============================================================
//   async initializePools(pools: DexPool[]) {
//     if (!pools.length) return; 

//     const v3 = pools.filter(p => p.dex === DexType.UNISWAP_V3);
//     const v4 = pools.filter(p => p.dex === DexType.UNISWAP_V4);

//     if (v3.length) await this.initV3Pools(v3);
//     if (v4.length) await this.initV4Pools(v4);
//   }

//   // ============================================================
//   // V3 — multicall balanceOf(pool contract address)
//   // V3 pools are their own contracts — exact per-pool balance.
//   // ============================================================
//   private async initV3Pools(pools: DexPool[]) {

//     const provider  = this.provider.getProvider();
//     const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);

//     const calls:   { target: string; callData: string }[] = [];
//     const callMap: { pool: DexPool; side: "token0" | "token1" | "slot0" }[] = [];

//     for (const pool of pools) {
//       calls.push({
//         target:   pool.token0.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token0" });

//       calls.push({
//         target:   pool.token1.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token1" });

//       calls.push({
//         target: pool.poolKey,
//         callData: V3_IFACE.encodeFunctionData("slot0", []),
//       });
//       callMap.push({ pool, side: "slot0" });
//     }

//     await this.runMulticall(multicall, calls, callMap);
//     for (const pool of pools) {
   
//       this.computeLiquidity(pool);
//       pool.isActive      = OnchainUtil.isActivePool(pool);

//       pool.isInitialized = true;
//     }

//     await this.poolRepo.save(pools);

//     this.logger.log(
//       `💧 V3: ${pools.length} pools — ` +
//       `${pools.filter(p => p.isActive).length} active, ` +
//       `${pools.filter(p => p.liquidityUsd > 0).length} with USD liquidity`
//     );
//   }
//   // ============================================================
//   // V4 STARTUP PRICE — StateView.getSlot0() via multicall
//   //
//   // Called after fetchTVLFromSubgraph so pools already have balances.
//   // Uses the same multicall batching pattern as V3 slot0.
//   // StateView accepts bytes32 poolId — never pass poolKey to getBalance().
//   // ============================================================
//   private async fetchV4StartupPrices(pools: DexPool[]) {
//     const provider      = this.provider.getProvider();
//     const multicall     = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);
//     const stateViewAddr = process.env.UNISWAP_V4_STATE_VIEW ?? DEFAULT_STATE_VIEW;
 
//     const slot0Calls = pools.map(pool => ({
//       target:   stateViewAddr,                                      // StateView contract
//       callData: V4_STATE_VIEW_IFACE.encodeFunctionData("getSlot0", [pool.poolKey]),
//     }));
 
//     for (let i = 0; i < slot0Calls.length; i += CHUNK_SIZE) {
//       try {
//         const results: { success: boolean; returnData: string }[] =
//           await multicall.tryAggregate.staticCall(false, slot0Calls.slice(i, i + CHUNK_SIZE));
 
//         for (let j = 0; j < results.length; j++) {
//           const { success, returnData } = results[j];
//           if (!success || returnData === "0x") continue;
 
//           try {
//             const [sqrtPriceX96] = V4_STATE_VIEW_IFACE.decodeFunctionResult("getSlot0", returnData);
//             const pool           = pools[i + j];
 
//             if (!sqrtPriceX96 || sqrtPriceX96 === 0n) continue; // pool not initialized on-chain yet
 

//             const price = OnchainUtil.sqrtPriceToPrice(
//               sqrtPriceX96,
//               pool.token0.decimals,
//               pool.token1.decimals
//             );

//             if (price != null)     
//             OnchainUtil.applyPrice(pool, price, this.priceCache);
//       //   if(pool.token0.symbol=='TOMI') {   console.log("fetchV4StartupPrices price",price , sqrtPriceX96,
//       //   pool.token0.decimals,
//       //   pool.token1.decimals )
//       // process.exit();
//       // }

//             this.logger.debug(
//               `V4 ${pool.token0.symbol}/${pool.token1.symbol} ` +
//               `price=$${price?.toFixed(4) ?? "n/a"}`
//             );
//           } catch {
//             this.logger.warn(`V4 getSlot0 decode failed pool=${pools[i + j].poolKey}`);
//           }
//         }
//       } catch (err) {
//         this.logger.error(`V4 StateView multicall chunk failed i=${i}`, err);
//       }
//     }
//   }
//   // ============================================================
//   // V4 INIT — subgraph for exact per-pool TVL
//   //
//   // WHY subgraph and not on-chain calls:
//   //   balanceOf(PoolManager)  → total across ALL V4 pools (wrong)
//   //   getLiquidity() formula  → in-range only, ignores OOR positions (wrong)
//   //   subgraph totalValueLockedToken0/1 → all positions summed (correct)
//   //
//   // Subgraph has 1-5 min lag — acceptable for init snapshot.
//   // Real-time updates come from Swap event delta tracking.
//   // LP changes (ModifyLiquidity) trigger a targeted re-sync.
//   // ============================================================
//   private async initV4Pools(pools: DexPool[]) {
//     await this.fetchTVLFromSubgraph(pools);
//     await this.fetchV4StartupPrices(pools);

//     await this.poolRepo.save(pools);

// await this.autoMapper.mapPoolsV4(pools)

//     this.logger.log(
//       `ssssss💧 V4: ${pools.filter(p => p.isInitialized).length} pools — ` +
//       `${pools.filter(p => p.isActive).length} active`
//     );
//   }

//   // ============================================================
//   // SUBGRAPH TVL FETCH
//   // Shared by: initV4Pools (startup) + scheduleV4Refresh (ModifyLiquidity)
//   //
//   // totalValueLockedToken0/1 = sum of ALL positions across ALL ticks
//   // Returned in human-readable units (no decimal conversion needed)
//   // ============================================================
//   private async fetchTVLFromSubgraph(pools: DexPool[]) {
//     console.log(" fetchTVLFromSubgraph",pools?.length)

//     const apiKey = "069891b5ca120b29736ac9de3803bc52";
//         if (!apiKey) {
//       this.logger.error(
//         "❌ GRAPH_API_KEY not set — V4 TVL will be 0. " +
//         "Get a free key at https://thegraph.com/studio"
//       );
//       // Mark all as initialized so app doesn't hang, but TVL = 0
//       for (const pool of pools) {
//         pool.isInitialized = true;
//         pool.isActive      = false;
//       }
//       return;
//     }

    

//     const SUBGRAPH_URL =
//       `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${V4_SUBGRAPH_ID}`;

//     // Batch in groups of 100 (subgraph max per query)
//     for (let i = 0; i < pools.length; i += CHUNK_SIZE) {
//       const batch = pools.slice(i, i + CHUNK_SIZE);

//       // poolKey is bytes32 — subgraph stores as lowercase hex
//       const ids   = batch.map(p => `"${p.poolKey.toLowerCase()}"`).join(",");
//       const query = `{
//         pools(where: { id_in: [${ids}] }) {
//           id
//           totalValueLockedToken0
//           totalValueLockedToken1
//         }
//       }`;

//       try {
//         const res = await fetch(SUBGRAPH_URL, {
//           method:  "POST",
//           headers: { "Content-Type": "application/json" },
//           body:    JSON.stringify({ query }),
//         });

//         const json = await res.json();

//         if (json.errors) {
//           // Log full error so schema mismatches are immediately visible
//           this.logger.error(
//             `Subgraph errors batch i=${i}: ` + JSON.stringify(json.errors)
//           );
//           continue;
//         }

//         if (!json.data?.pools) {
//           this.logger.warn(
//             `Subgraph returned no pool data for batch i=${i}. ` +
//             `Response: ` + JSON.stringify(json.data)
//           );
//           continue;
//         }

//         // Build lookup by poolId
//         const byId = new Map<string, { totalValueLockedToken0: string; totalValueLockedToken1: string }>();
//         for (const p of json.data.pools) {
//           byId.set(p.id.toLowerCase(), p);
//         }

//         for (const pool of batch) {
//           const data = byId.get(pool.poolKey.toLowerCase());

//           pool.isInitialized = true;

//           if (!data) {
//             // Pool not indexed yet (just created) — mark inactive for now
//             this.logger.debug(`No subgraph data for ${pool.poolKey}`);
//             pool.isActive = false;
//             continue;
//           }

//           // ✅ Human-readable amounts — no decimal conversion needed
//           pool.token0Balance = parseFloat(data.totalValueLockedToken0) || 0;
//           pool.token1Balance = parseFloat(data.totalValueLockedToken1) || 0;

//           const priceOk = this.computeLiquidity(pool);

//           pool.isActive =
//             pool.token0Balance > 0 &&
//             pool.token1Balance > 0 &&
//             (pool.liquidityUsd > 1000 || !priceOk); // tentative active if price not loaded yet
//             console.log("priceOkpriceOkpriceOk",pool.poolKey,pool.token0Balance,pool.token1Balance,pool.price)

//           this.logger.debug(
//             `V4 ${pool.token0.symbol}/${pool.token1.symbol} ` +
//             `tvl0=${pool.token0Balance.toFixed(4)} ` +
//             `tvl1=${pool.token1Balance.toFixed(4)} ` +
//             `usd=$${pool.liquidityUsd.toFixed(2)} ` +
//             `active=${pool.isActive}`
//           );
//         }

//       } catch (err) {
//         this.logger.error(`Subgraph fetch failed batch i=${i}`, err);
//         // Don't block — mark batch as initialized with 0 balances
//         for (const pool of batch) {
//           pool.isInitialized = true;
//         }
//       }
//     }
//     console.log("finsit initialiation")
//   }

//   // ============================================================
//   // COMPUTE USD LIQUIDITY
//   // Returns true if at least one price was available.
//   // ============================================================
//   computeLiquidity(pool: DexPool): boolean {
//     const ok = OnchainUtil.computeLiquidityUsd(pool, this.priceCache);
//     if (!ok) {
//       this.logger.warn(
//         `⚠️  No price for ${pool.token0.symbol}/${pool.token1.symbol} — ` +
//         `liquidityUsd cannot be computed. Is PriceCacheService loaded?`
//       );
//     }
//     return ok;

//     // const sym0   = canonicalSymbol(pool.token0);
//     // const sym1   = canonicalSymbol(pool.token1);
//     // const price0 = this.priceCache.getPrice(sym0);
//     // const price1 = this.priceCache.getPrice(sym1);

//     // if (price0 == null && price1 == null) {
//     //   this.logger.warn(`⚠️  No price for ${sym0}/${sym1} — is PriceCacheService loaded?`);
//     //   return false;
//     // }

//     // pool.liquidityUsd =
//     //   (pool.token0Balance * (price0 ?? 0)) +
//     //   (pool.token1Balance * (price1 ?? 0));

//     // return true;
//   }

//   // ============================================================
//   // V4 SWAP UPDATE — delta tracking from event amounts
//   //
//   // Swap events emit exact amount0/amount1 for this pool.
//   // Swap does NOT change total pool TVL — it only changes the
//   // token0/token1 ratio. Delta tracking is therefore accurate.
//   //
//   // amount0: negative = token0 left pool, positive = token0 entered
//   // amount1: negative = token1 left pool, positive = token1 entered
//   //
//   // These are pre-formatted (post formatUnits) from the adapter.
//   // ============================================================
//   async updateV4FromSwap(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
//     pool.token1Balance = Math.max(0, pool.token1Balance + amount1);

//     this.computeLiquidity(pool);
//     pool.isActive   = pool.liquidityUsd > 1000;
//     pool.lastSwapAt = Date.now();

//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V3 SWAP / MINT / BURN — delta balance tracking
//   // amounts must be pre-formatted (post formatUnits) by adapter
//   // ============================================================
//   async updateFromSwap(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
//     pool.token1Balance = Math.max(0, pool.token1Balance + amount1);

//     this.computeLiquidity(pool);
//     pool.isActive   = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
//     pool.lastSwapAt = Date.now();

//     await this.poolRepo.save(pool);
//   }

//   async updateFromMint(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance += Math.abs(amount0);
//     pool.token1Balance += Math.abs(amount1);
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   async updateFromBurn(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance - Math.abs(amount0));
//     pool.token1Balance = Math.max(0, pool.token1Balance - Math.abs(amount1));
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V4 MODIFY LIQUIDITY — targeted subgraph re-sync
//   //
//   // ModifyLiquidity = LP adding or removing positions.
//   // This DOES change total pool TVL — delta tracking is not enough.
//   // Re-fetch from subgraph after 60s debounce (subgraph needs time
//   // to index the event — querying at 5s would return stale data).
//   //
//   // Only the affected pool is re-synced — not all pools.
//   // ============================================================
//   private refreshTimers = new Map<string, NodeJS.Timeout>();

//   scheduleV4Refresh(pool: DexPool) {
//     // Debounce: if LP adds/removes rapidly, only fire once
//     if (this.refreshTimers.has(pool.poolKey)) return;

//     const timer = setTimeout(async () => {
//       this.logger.debug(`🔄 Re-syncing TVL for ${pool.token0.symbol}/${pool.token1.symbol}`);

//       await this.fetchTVLFromSubgraph([pool]);
//       await this.fetchV4StartupPrices([pool]);

//       await this.poolRepo.save([pool]);
//       await this.autoMapper.mapPoolsV4([pool]); 
//       this.refreshTimers.delete(pool.poolKey);
//     }, 60_000); // 60s — gives subgraph time to index ModifyLiquidity

//     this.refreshTimers.set(pool.poolKey, timer);
//   }

//   // ============================================================
//   // MULTICALL HELPER — used by V3 only
//   // tryAggregate: one failed call doesn't abort the chunk
//   // ============================================================
//   private async runMulticall(
    
//     multicall: ethers.Contract,
//     calls:   { target: string; callData: string }[],
//     callMap: { pool: DexPool; side: "token0" | "token1"  | "slot0"  }[],
//   ) {
//     for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
//       const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
//       const chunkMap   = callMap.slice(i, i + CHUNK_SIZE);

//       try {


//         const results: { success: boolean; returnData: string }[] =
//           await multicall.tryAggregate.staticCall(false, chunkCalls);

//         for (let j = 0; j < results.length; j++) {
//           const { success, returnData } = results[j];
//           const { pool, side } = chunkMap[j];

//           if (!success || returnData === "0x") {
//             this.logger.debug(`balanceOf failed pool=${pool.poolKey} side=${side}`);
//             continue;
//           }

//           try {
          
//             if (side === "slot0") {
//               const [sqrtPriceX96] = V3_IFACE.decodeFunctionResult("slot0", returnData);
//              const price = OnchainUtil.sqrtPriceToPrice(
//                           sqrtPriceX96,
//                           pool.token0.decimals,
//                           pool.token1.decimals
//              );
//              if (price != null)  OnchainUtil.applyPrice(pool, price, this.priceCache);
//             }
            
            
        

         
//             const [raw]    = ERC20_IFACE.decodeFunctionResult("balanceOf", returnData);
//             const decimals = side === "token0" ? pool.token0.decimals : pool.token1.decimals;
//             const amount   = Number(ethers.formatUnits(raw, decimals));
//             if (side === "token0")  {                 pool.token0Balance = amount;
//             }
//             if (side === "token1"){ pool.token1Balance = amount;}

  
//           } catch {
//             this.logger.warn(`Decode failed pool=${pool.poolKey} side=${side}`);
//           }
//         }
//       } catch (err) {
//         this.logger.error(`Multicall chunk failed i=${i}`, err);
//       }
//     }
//   }
// }

















/*same as below for all pool balance but formulas and single pool balance */

// // ============================================================
// // shared-liquidity.service.ts
// //
// // V3: multicall balanceOf on each pool contract  (fast, accurate)
// // V4: StateView getSlot0+getLiquidity per pool   (correct architecture)
// //     + event-driven update via sqrtPriceX96 from Swap events
// // ============================================================
// import { Injectable, Logger } from "@nestjs/common";
// import { ethers } from "ethers";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { DexPool } from "../../../common/entities/pool.entityt";
// import { EthereumProvider } from "../../../providers/ethereum.provider";
// import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
// import { DexType } from "../../../common/chain.enum";
// import { canonicalSymbol } from "./pool-filter";

// // ── ABIs ────────────────────────────────────────────────────
// const ERC20_ABI     = ["function balanceOf(address) view returns (uint256)"];
// const ERC20_IFACE   = new ethers.Interface(ERC20_ABI);

// const MULTICALL_ABI = [
//   "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)",
// ];

// const STATE_VIEW_ABI = [
//   // Returns current sqrtPriceX96 and tick for a V4 pool
//   "function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
//   // Returns total active liquidity for a V4 pool
//   "function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)",
// ];

// // Uniswap's deployed Multicall3 (same address on all EVM chains)
// const MULTICALL_ADDRESS  = "0xcA11bde05977b3631167028862bE2a173976CA11";

// // Uniswap V4 StateView — mainnet
// // Add UNISWAP_V4_STATE_VIEW to your .env to override
// const DEFAULT_STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";

// const CHUNK_SIZE = 150; // safe multicall batch size

// @Injectable()
// export class SharedLiquidityService {
//   private logger = new Logger(SharedLiquidityService.name);

//   constructor(
//     private readonly provider:    EthereumProvider,
//     private readonly priceCache:  PriceCacheService,
//     @InjectRepository(DexPool) private poolRepo: Repository<DexPool>,
//   ) {}

//   // ============================================================
//   // PUBLIC ENTRY POINT
//   // Splits pools by DEX type and routes to the correct strategy.
//   // ============================================================
//   async initializePools(pools: DexPool[]) {
//     if (!pools.length) return;

//     const v3Pools = pools.filter(p => p.dex === DexType.UNISWAP_V3);
//     const v4Pools = pools.filter(p => p.dex === DexType.UNISWAP_V4);

//     if (v3Pools.length) await this.initV3Pools(v3Pools);
//     if (v4Pools.length) await this.initV4Pools(v4Pools);
//   }

//   // ============================================================
//   // V3 — multicall balanceOf on each pool's own contract address
//   //
//   // V3 pools ARE their own contracts, so balanceOf(pool.poolKey)
//   // gives the exact token balance for that specific pool.
//   // ============================================================
//   private async initV3Pools(pools: DexPool[]) {
//     const provider  = this.provider.getProvider();
//     const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);

//     const calls:   { target: string; callData: string }[] = [];
//     const callMap: { pool: DexPool; side: "token0" | "token1" }[] = [];

//     for (const pool of pools) {
//       // token0
//       calls.push({
//         target:   pool.token0.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token0" });

//       // token1
//       calls.push({
//         target:   pool.token1.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token1" });
//     }

//     // Process in chunks of 150
//     for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
//       const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
//       const chunkMap   = callMap.slice(i, i + CHUNK_SIZE);

//       try {
//         const [, returnData] = await multicall.aggregate(chunkCalls);

//         for (let j = 0; j < returnData.length; j++) {
//           const { pool, side } = chunkMap[j];
//           try {
//             const [raw]    = ERC20_IFACE.decodeFunctionResult("balanceOf", returnData[j]);
//             const decimals = side === "token0" ? pool.token0.decimals : pool.token1.decimals;
//             const amount   = Number(ethers.formatUnits(raw, decimals));

//             if (side === "token0") pool.token0Balance = amount;
//             else                   pool.token1Balance = amount;

//           } catch {
//             this.logger.warn(`V3 decode failed: pool=${pool.poolKey} side=${side}`);
//           }
//         }
//       } catch (err) {
//         this.logger.warn(`V3 multicall chunk failed at index ${i}`, err);
//       }
//     }

//     // Compute USD liquidity and persist
//     for (const pool of pools) {
//       this.computeLiquidity(pool);
//       pool.isActive      = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
//       pool.isInitialized = true;
//     }

//     await this.poolRepo.save(pools);
//     this.logger.log(`💧 V3: initialized ${pools.length} pools`);
//   }

//   // ============================================================
//   // V4 — StateView contract per pool
//   //
//   // WHY NOT balanceOf for V4:
//   //   All V4 liquidity lives in the singleton PoolManager contract.
//   //   balanceOf(PoolManager) returns the TOTAL across ALL V4 pools
//   //   combined — useless for per-pool TVL.
//   //   pool.poolKey is a bytes32 poolId, NOT a contract address,
//   //   so getBalance(pool.poolKey) throws UNCONFIGURED_NAME.
//   //
//   // CORRECT APPROACH:
//   //   Use StateView.getSlot0(poolId) → sqrtPriceX96
//   //   Use StateView.getLiquidity(poolId) → active liquidity L
//   //   Derive token amounts from the concentrated liquidity formula:
//   //     amount1 = L × sqrtPrice  (in raw units)
//   //     amount0 = L / sqrtPrice
//   //   Then convert to USD using priceCache.
//   // ============================================================
//   private async initV4Pools(pools: DexPool[]) {
//     const provider  = this.provider.getProvider();
//     const stateView = new ethers.Contract(
//       process.env.UNISWAP_V4_STATE_VIEW ?? DEFAULT_STATE_VIEW,
//       STATE_VIEW_ABI,
//       provider,
//     );

//     let initialized = 0;

//     for (const pool of pools) {
//       try {
//         const [sqrtPriceX96] = await stateView.getSlot0(pool.poolKey);
//         const liquidity       = await stateView.getLiquidity(pool.poolKey);

//         // Pool not yet initialized on-chain (price = 0)
//         if (!sqrtPriceX96 || sqrtPriceX96 === 0n) {
//           pool.isActive      = false;
//           pool.isInitialized = true;
//           continue;
//         }

//         this.applyV4Liquidity(pool, sqrtPriceX96, liquidity);
//         pool.isInitialized = true;
//         initialized++;

//       } catch (err) {
//         this.logger.warn(`V4 StateView failed: pool=${pool.poolKey}`, err);
//       }
//     }

//     await this.poolRepo.save(pools);
//     this.logger.log(`💧 V4: initialized ${initialized}/${pools.length} pools via StateView`);
//   }

//   // ============================================================
//   // V4 LIQUIDITY MATH
//   //
//   // Uniswap V4 concentrated liquidity formula:
//   //   sqrtPrice = sqrtPriceX96 / 2^96   (in token1/token0 ratio space)
//   //
//   //   virtual_amount1 = L × sqrtPrice
//   //   virtual_amount0 = L / sqrtPrice
//   //
//   // These are virtual amounts that represent the pool's depth at
//   // the current tick — not total locked tokens, but good enough
//   // for TVL estimation and isActive filtering.
//   //
//   // Adjust for decimal difference between token0 and token1.
//   // ============================================================
//   private applyV4Liquidity(pool: DexPool, sqrtPriceX96: bigint, liquidity: bigint) {
//     const Q96       = 2 ** 96;
//     const sqrtPrice = Number(sqrtPriceX96) / Q96;

//     const L = Number(liquidity);

//     // Raw token amounts (before decimal adjustment)
//     const raw0 = L / sqrtPrice;
//     const raw1 = L * sqrtPrice;

//     // Adjust for token decimals
//     pool.token0Balance = raw0 / (10 ** pool.token0.decimals);
//     pool.token1Balance = raw1 / (10 ** pool.token1.decimals);
// console.log("ppp",pool.id,pool.poolKey,pool.token0Balance,pool.token1Balance)
//     this.computeLiquidity(pool);
//        this.poolRepo.save(pool);

//     pool.isActive = pool.liquidityUsd > 1000;
//   }

//   // ============================================================
//   // USD LIQUIDITY  (shared by V3 + V4)
//   // ============================================================
//   computeLiquidity(pool: DexPool) {
//     const sym0   = canonicalSymbol(pool.token0);
//     const sym1   = canonicalSymbol(pool.token1);
//     const price0 = this.priceCache.getPrice(sym0);
//     const price1 = this.priceCache.getPrice(sym1);

//     if (price0 == null || price1 == null) return;
 
//     pool.liquidityUsd =
//       (pool.token0Balance * price0) +
//       (pool.token1Balance * price1);
//   }

//   // ============================================================
//   // V4 SWAP UPDATE  (called from V4 adapter on every Swap event)
//   //
//   // V4 Swap events include sqrtPriceX96 and liquidity directly,
//   // so we can recompute pool depth without any extra RPC call.
//   // This is more accurate than balance tracking for V4.
//   // ============================================================
//   updateV4FromSwap( 
//     pool:         DexPool,
//     sqrtPriceX96: bigint,
//     liquidity:    bigint,
//     amount0:      number,   // formatted, for volume tracking only
//     amount1:      number,
//   ) {
//     // Recompute pool depth from new price + liquidity
//     this.applyV4Liquidity(pool, sqrtPriceX96, liquidity);

//     pool.lastSwapAt = Date.now();
//     // Note: caller handles volume24h and score update
//   }

//   // ============================================================
//   // V3 SWAP UPDATE  (balance tracking — amounts already formatUnits)
//   // ============================================================
//   async updateFromSwap(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
//     pool.token1Balance = Math.max(0, pool.token1Balance + amount1);

//     this.computeLiquidity(pool);
//     pool.isActive   = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
//     pool.lastSwapAt = Date.now();

//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V3 MINT / BURN  (amounts already formatUnits)
//   // ============================================================
//   async updateFromMint(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance += Math.abs(amount0);
//     pool.token1Balance += Math.abs(amount1);
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   async updateFromBurn(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance - Math.abs(amount0));
//     pool.token1Balance = Math.max(0, pool.token1Balance - Math.abs(amount1));
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V4 MODIFY LIQUIDITY — schedule StateView refresh
//   // ModifyLiquidity doesn't emit token amounts in V4,
//   // so we re-query StateView after a short debounce.
//   // ============================================================
//   private refreshTimers = new Map<string, NodeJS.Timeout>();

//   scheduleV4Refresh(pool: DexPool) {
//     if (this.refreshTimers.has(pool.poolKey)) return;

//     const timer = setTimeout(async () => {
//       await this.initializePools([pool]);
//       this.refreshTimers.delete(pool.poolKey);
//     }, 30_000);

//     this.refreshTimers.set(pool.poolKey, timer);
//   }
// }






























/* for all v4 balalnce like total ETH on v4 against all v4 pools */

// // ============================================================
// // shared-liquidity.service.ts
// //
// // V3 → multicall balanceOf(poolAddress)     — exact per-pool balance
// // V4 → multicall balanceOf(poolManager)     — real total token balance
// //      + provider.getBalance(poolManager)   — real ETH balance
// //      + StateView.getSlot0()               — for price only (not TVL)
// //      + Swap event sqrtPriceX96+liquidity  — real-time TVL update
// // ============================================================
// import { Injectable, Logger } from "@nestjs/common";
// import { ethers } from "ethers";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { DexPool } from "../../../common/entities/pool.entityt";
// import { EthereumProvider } from "../../../providers/ethereum.provider";
// import { PriceCacheService } from "@/common-module/price-cache-service/price-cache.service";
// import { DexType } from "../../../common/chain.enum";
// import { canonicalSymbol } from "./pool-filter";

// // ── Constants ────────────────────────────────────────────────
// const ZERO         = "0x0000000000000000000000000000000000000000";
// const CHUNK_SIZE   = 100;
// const MULTICALL_ADDRESS  = "0xcA11bde05977b3631167028862bE2a173976CA11";
// const DEFAULT_STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";

// // ── ABIs ─────────────────────────────────────────────────────
// const ERC20_ABI   = ["function balanceOf(address) view returns (uint256)"];
// const ERC20_IFACE = new ethers.Interface(ERC20_ABI);

// const MULTICALL_ABI = [
//   "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
// ];

// const STATE_VIEW_ABI = [
//   "function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
// ];
// const STATE_VIEW_IFACE = new ethers.Interface(STATE_VIEW_ABI);

// // ─────────────────────────────────────────────────────────────

// @Injectable()
// export class SharedLiquidityService {
//   private logger = new Logger(SharedLiquidityService.name);

//   constructor(
//     private readonly provider:   EthereumProvider,
//     private readonly priceCache: PriceCacheService,
//     @InjectRepository(DexPool) private poolRepo: Repository<DexPool>,
//   ) {}

//   // ============================================================
//   // ENTRY POINT — routes V3 and V4 to correct strategy
//   // ============================================================
//   async initializePools(pools: DexPool[]) {
//     if (!pools.length) return;

//     const v3 = pools.filter(p => p.dex === DexType.UNISWAP_V3);
//     const v4 = pools.filter(p => p.dex === DexType.UNISWAP_V4);

//     if (v3.length) await this.initV3Pools(v3);
//     if (v4.length) await this.initV4Pools(v4);
//   }

//   // ============================================================
//   // V3 — balanceOf(pool contract address)
//   // Each V3 pool is its own contract — exact balance per pool.
//   // ============================================================
//   private async initV3Pools(pools: DexPool[]) {
//     const provider  = this.provider.getProvider();
//     const multicall = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);

//     const calls:   { target: string; callData: string }[] = [];
//     const callMap: { pool: DexPool; side: "token0" | "token1" }[] = [];

//     for (const pool of pools) {
//       calls.push({
//         target:   pool.token0.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token0" });

//       calls.push({
//         target:   pool.token1.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [pool.poolKey]),
//       });
//       callMap.push({ pool, side: "token1" });
//     }

//     await this.runMulticall(multicall, calls, callMap);

//     for (const pool of pools) {
//       this.computeLiquidity(pool);
//       pool.isActive      = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
//       pool.isInitialized = true;
//     }

//     await this.poolRepo.save(pools);

//     this.logger.log(
//       `💧 V3: ${pools.length} pools init — ` +
//       `${pools.filter(p => p.isActive).length} active, ` +
//       `${pools.filter(p => p.liquidityUsd > 0).length} with USD liquidity`
//     );
//   }

//   // ============================================================
//   // V4 — THREE-STEP INIT
//   //
//   // Step 1: balanceOf(PoolManager) for ERC-20 tokens
//   //   All V4 token liquidity (in-range + out-of-range) sits in
//   //   the PoolManager contract. This is the REAL total balance,
//   //   not just the in-range virtual depth from getLiquidity().
//   //   Note: this is shared across all V4 pools with the same token,
//   //   which means pools with the same token pair share the reading.
//   //   It's the best single-call approximation available without
//   //   reading every individual position.
//   //
//   // Step 2: provider.getBalance(poolManager) for native ETH
//   //   The PoolManager holds ETH directly. poolKey is bytes32 —
//   //   NOT an address — so getBalance(poolKey) throws UNCONFIGURED_NAME.
//   //   Always call getBalance on the CONTRACT ADDRESS.
//   //
//   // Step 3: getSlot0 via StateView for current sqrtPriceX96
//   //   Used only for price calculation (normalizeToUSD), not TVL.
//   // ============================================================
//   private async initV4Pools(pools: DexPool[]) {
//     const provider      = this.provider.getProvider();
//     const multicall     = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, provider);
//     const poolManager   = process.env.UNISWAP_V4_POOL_MANAGER!.toLowerCase();
//     const stateViewAddr = process.env.UNISWAP_V4_STATE_VIEW ?? DEFAULT_STATE_VIEW;

//     // ── STEP 1: ERC-20 balanceOf(PoolManager) ────────────────
//     const erc20Calls:   { target: string; callData: string }[] = [];
//     const erc20CallMap: { pool: DexPool; side: "token0" | "token1" }[] = [];

//     for (const pool of pools) {
//       // token0 — skip native ETH (address zero has no balanceOf)
//       if (pool.token0.address.toLowerCase() !== ZERO) {
//         erc20Calls.push({
//           target:   pool.token0.address,
//           callData: ERC20_IFACE.encodeFunctionData("balanceOf", [poolManager]),
//         });
//         erc20CallMap.push({ pool, side: "token0" });
//       }

//       // token1 is never address(0) — V4 sorts address(0) as currency0
//       erc20Calls.push({
//         target:   pool.token1.address,
//         callData: ERC20_IFACE.encodeFunctionData("balanceOf", [poolManager]),
//       });
//       erc20CallMap.push({ pool, side: "token1" });
//     }

//     await this.runMulticall(multicall, erc20Calls, erc20CallMap);

//     // ── STEP 2: Native ETH balance of PoolManager ────────────
//     // ✅ getBalance(poolManager ADDRESS) — NOT poolKey (bytes32)
//     const ethPools = pools.filter(
//       p => p.token0.address.toLowerCase() === ZERO
//     );

//     if (ethPools.length) {
//       try {
//         const ethBal    = await provider.getBalance(poolManager);
//         const ethAmount = Number(ethers.formatUnits(ethBal, 18));
//         this.logger.log(`💰 PoolManager ETH balance: ${ethAmount.toFixed(4)} ETH`);
//         // All ETH pools get the same PoolManager ETH balance reading
//         for (const pool of ethPools) {
//           pool.token0Balance = ethAmount;
//         }
//       } catch (err) {
//         this.logger.error("ETH balance fetch failed", err);
//       }
//     }

//     // ── STEP 3: getSlot0 for current price (not TVL) ─────────
//     const slot0Calls   = pools.map(pool => ({
//       target:   stateViewAddr,
//       callData: STATE_VIEW_IFACE.encodeFunctionData("getSlot0", [pool.poolKey]),
//     }));

//     // Map poolKey → sqrtPriceX96
//     const sqrtPriceMap = new Map<string, bigint>();

//     for (let i = 0; i < slot0Calls.length; i += CHUNK_SIZE) {
//       try {
//         const results: { success: boolean; returnData: string }[] =
//           await multicall.tryAggregate.staticCall(false, slot0Calls.slice(i, i + CHUNK_SIZE));

//         for (let j = 0; j < results.length; j++) {
//           const { success, returnData } = results[j];
//           if (!success || returnData === "0x") continue;
//           try {
//             const [sqrtPriceX96] = STATE_VIEW_IFACE.decodeFunctionResult("getSlot0", returnData);
//             sqrtPriceMap.set(pools[i + j].poolKey, sqrtPriceX96 as bigint);
//           } catch {
//             // pool not initialized on-chain yet
//           }
//         }
//       } catch (err) {
//         this.logger.error(`StateView getSlot0 chunk failed i=${i}`, err);
//       }
//     }

//     // ── STEP 4: Compute liquidity + persist ──────────────────
//     let initialized = 0;

//     for (const pool of pools) {
//       const sqrtPriceX96 = sqrtPriceMap.get(pool.poolKey);

//       pool.isInitialized = true;

//       if (!sqrtPriceX96 || sqrtPriceX96 === 0n) {
//         // Pool exists in DB but not yet initialized on-chain
//         pool.isActive = false;
//         continue;
//       }

//       // Store sqrtPriceX96 on the pool for later normalizeToUSD use
//       // (adapter reads pool.token0Balance / token1Balance for liquidity,
//       //  and uses sqrtPriceX96 math for price direction)
//       const priceOk = this.computeLiquidity(pool);

//       pool.isActive =
//         pool.liquidityUsd > 1000 &&
//         pool.token0Balance > 0 &&
//         pool.token1Balance > 0;

//       if (!priceOk && pool.token0Balance > 0 && pool.token1Balance > 0) {
//         // Has real balance but priceCache not loaded yet
//         // Mark active tentatively — will be corrected on first swap
//         pool.isActive     = true;
//         pool.liquidityUsd = 0;
//       }

//       initialized++;
// console.log("ppppp",pool.poolKey,pool.token0Balance,pool.token1Balance,pool.liquidityUsd)
//       this.logger.debug(
//         `V4 ${pool.token0.symbol}/${pool.token1.symbol} ` +
//         `bal0=${pool.token0Balance.toFixed(4)} ` +
//         `bal1=${pool.token1Balance.toFixed(4)} ` +
//         `usd=${pool.liquidityUsd.toFixed(2)} ` +
//         `active=${pool.isActive}`
//       );
//     }

//     await this.poolRepo.save(pools);

//     this.logger.log(
//       `💧 V4: ${initialized}/${pools.length} pools init — ` +
//       `${pools.filter(p => p.isActive).length} active`
//     );
//   }

//   // ============================================================
//   // MULTICALL HELPER — shared by V3 and V4 ERC-20 calls
//   // Uses tryAggregate so one failed call doesn't abort the chunk
//   // ============================================================
//   private async runMulticall(
//     multicall: ethers.Contract,
//     calls:   { target: string; callData: string }[],
//     callMap: { pool: DexPool; side: "token0" | "token1" }[],
//   ) {
//     for (let i = 0; i < calls.length; i += CHUNK_SIZE) {
//       const chunkCalls = calls.slice(i, i + CHUNK_SIZE);
//       const chunkMap   = callMap.slice(i, i + CHUNK_SIZE);

//       try {
//         const results: { success: boolean; returnData: string }[] =
//           await multicall.tryAggregate.staticCall(false, chunkCalls);

//         for (let j = 0; j < results.length; j++) {
//           const { success, returnData } = results[j];
//           const { pool, side } = chunkMap[j];

//           if (!success || returnData === "0x") {
//             this.logger.debug(`balanceOf failed pool=${pool.poolKey} side=${side}`);
//             continue;
//           }

//           try {
//             const [raw]    = ERC20_IFACE.decodeFunctionResult("balanceOf", returnData);
//             const decimals = side === "token0" ? pool.token0.decimals : pool.token1.decimals;
//             const amount   = Number(ethers.formatUnits(raw, decimals));

//             if (side === "token0") pool.token0Balance = amount;
//             else                   pool.token1Balance = amount;

//           } catch {
//             this.logger.warn(`Decode failed pool=${pool.poolKey} side=${side}`);
//           }
//         }
//       } catch (err) {
//         this.logger.error(`Multicall chunk failed i=${i}`, err);
//       }
//     }
//   }

//   // ============================================================
//   // COMPUTE USD LIQUIDITY
//   // Returns true if at least one price was available.
//   // ============================================================
//   computeLiquidity(pool: DexPool): boolean {
//     const sym0   = canonicalSymbol(pool.token0);
//     const sym1   = canonicalSymbol(pool.token1);
//     const price0 = this.priceCache.getPrice(sym0);
//     const price1 = this.priceCache.getPrice(sym1);

//     if (price0 == null && price1 == null) {
//       this.logger.warn(`⚠️  No price for ${sym0}/${sym1} — is PriceCacheService loaded?`);
//       return false;
//     }

//     pool.liquidityUsd =
//       (pool.token0Balance * (price0 ?? 0)) +
//       (pool.token1Balance * (price1 ?? 0));

//     return true;
//   }

//   // ============================================================
//   // V4 SWAP UPDATE
//   // Recomputes TVL from sqrtPriceX96 + liquidity in the event.
//   // This keeps balances in sync after every swap — no RPC call.
//   //
//   // V4 Swap emits both sqrtPriceX96 (new price after swap) and
//   // liquidity (active liquidity at that tick). Use the formula:
//   //   amount0 = L / sqrtPrice
//   //   amount1 = L * sqrtPrice
//   // These are virtual in-range amounts — good enough for
//   // real-time price tracking. Full TVL reconciled on ModifyLiquidity.
//   // ============================================================
//   async updateV4FromSwap(
//     pool:         DexPool,
//     sqrtPriceX96: bigint,
//     liquidity:    bigint,
//   ) {
//     const Q96        = 2 ** 96;
//     const sqrtPrice  = Number(sqrtPriceX96) / Q96;
//     const L          = Number(liquidity);

//     // Update in-range virtual balances from swap event
//     // (Full TVL re-read happens on ModifyLiquidity via scheduleV4Refresh)
//     const virtual0 = (L / sqrtPrice)  / (10 ** pool.token0.decimals);
//     const virtual1 = (L * sqrtPrice)  / (10 ** pool.token1.decimals);

//     // Only update balances if virtual amounts are non-zero
//     // — prevents zeroing out the PoolManager balance we fetched at init
//     if (virtual0 > 0) pool.token0Balance = virtual0;
//     if (virtual1 > 0) pool.token1Balance = virtual1;

//     this.computeLiquidity(pool);
//     pool.isActive   = pool.liquidityUsd > 1000;
//     pool.lastSwapAt = Date.now();

//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V3 SWAP / MINT / BURN — delta balance tracking
//   // amounts must be pre-formatted (post formatUnits) by adapter
//   // ============================================================
//   async updateFromSwap(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance + amount0);
//     pool.token1Balance = Math.max(0, pool.token1Balance + amount1);

//     this.computeLiquidity(pool);
//     pool.isActive   = pool.liquidityUsd > 1000 && pool.token0Balance > 0 && pool.token1Balance > 0;
//     pool.lastSwapAt = Date.now();

//     await this.poolRepo.save(pool);
//   }

//   async updateFromMint(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance += Math.abs(amount0);
//     pool.token1Balance += Math.abs(amount1);
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   async updateFromBurn(pool: DexPool, amount0: number, amount1: number) {
//     pool.token0Balance = Math.max(0, pool.token0Balance - Math.abs(amount0));
//     pool.token1Balance = Math.max(0, pool.token1Balance - Math.abs(amount1));
//     this.computeLiquidity(pool);
//     await this.poolRepo.save(pool);
//   }

//   // ============================================================
//   // V4 MODIFY LIQUIDITY — schedule full PoolManager balance refresh
//   // ModifyLiquidity changes total TVL, so we re-read the real
//   // PoolManager balance (not just virtual in-range amounts).
//   // Debounced 30s so rapid LP activity doesn't spam RPC.
//   // ============================================================
//   private refreshTimers = new Map<string, NodeJS.Timeout>();

//   scheduleV4Refresh(pool: DexPool) {
//     if (this.refreshTimers.has(pool.poolKey)) return;

//     const timer = setTimeout(async () => {
//       await this.initializePools([pool]);
//       this.refreshTimers.delete(pool.poolKey);
//     }, 30_000);

//     this.refreshTimers.set(pool.poolKey, timer);
//   }
// }
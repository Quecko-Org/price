
import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ethers } from "ethers";

import { Chain, DexType } from "@/ingestion/onchain/common/chain.enum";
import { EthereumProvider } from "@/ingestion/onchain/providers/ethereum.provider";
import { Token } from "@/ingestion/onchain/common/entities/token.entity";
import { getPoolSides, isTrackablePool } from "../base/pool-filter";
import { DexAutoMapperService } from "@/ingestion/onchain/common/ingestion-cron/token-syncing/dex-auto-mapper.service";

// ✅ CORRECT: Only non-indexed params in the signature string for ethers.id()
// The event: Initialize(bytes32 indexed poolId, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks)
// ethers.id() always uses the full param types (indexed keyword is ignored in the hash)
const INIT_EVENT_TOPIC = ethers.id(
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
);

// Native ETH is represented as zero address in Uniswap V4
const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

@Injectable()
export class UniswapV4DiscoveryService {
  private logger = new Logger(UniswapV4DiscoveryService.name);
  private tokensByAddress = new Map<string, Token>();
  private tokensLoaded    = false;

  constructor(
    private readonly provider: EthereumProvider,

    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,

    @InjectRepository(Token)
    private tokenRepo: Repository<Token>,
    private readonly autoMapper: DexAutoMapperService,
  ) { }



  
  async init() {
    // await this.tokenRepo.save({
    //   chain: "ETH",
    //   chainId: 1,
    //   address: NATIVE_ETH_ADDRESS,
    //   symbol: "ETH",
    //   canonicalSymbol: "ETH",
    //   decimals: 18,
    // });

    if (this.tokensLoaded) return;
 
    const allTokens = await this.tokenRepo.find();
    allTokens.forEach(t =>
      this.tokensByAddress.set(t.address.toLowerCase(), t)
    );
 
    this.tokensLoaded = true;
    this.logger.log(`📋 Loaded ${this.tokensByAddress.size} tokens`);
 
    if (!this.tokensByAddress.has(NATIVE_ETH_ADDRESS)) {
      this.logger.warn(
        '⚠️  Native ETH (0x000...000) missing — ETH/token V4 pools will be skipped'
      );
    }
  
  }

  async backfill(fromBlock: number) {
    await this.init();
    const provider = new ethers.JsonRpcProvider("https://damp-responsive-patina.quiknode.pro/74d8bb211b35da533b021e761c494bfc957e5a30/");

    // const provider   = this.provider.getProvider();
    const latestBlock = await provider.getBlockNumber();
//     const latestBlock = await provider.getBlockNumber();

    const CHUNK = 2000;
    let   start = fromBlock;
 
    this.logger.log(`🚀 V4 backfill: block ${fromBlock} → ${latestBlock}`);
 
    while (start <= latestBlock) {
      const end = Math.min(start + CHUNK - 1, latestBlock);
 
      try {
        const logs = await provider.getLogs({
          address:   process.env.UNISWAP_V4_POOL_MANAGER,
          fromBlock: start,
          toBlock:   end,
          topics:    [INIT_EVENT_TOPIC],
        });
 
        if (logs.length) this.logger.log(`📦 ${start}→${end}: ${logs.length} pools`);
        for (const log of logs) await this.processLog(log);
 
      } catch (err) {
        this.logger.error(`❌ chunk ${start}-${end} failed`, err);
        await new Promise(r => setTimeout(r, 500));
      }
 
      start = end + 1;
    }
 
    this.logger.log('✅ V4 backfill complete');
  }
 
  // ------------------------------------------------------------------
  // LOG DECODER (shared by listener + backfill)
  // ------------------------------------------------------------------
  async processLog(log: ethers.Log) {
    const poolId    = log.topics[1];
    const currency0 = ethers.getAddress('0x' + log.topics[2].slice(26));
    const currency1 = ethers.getAddress('0x' + log.topics[3].slice(26));
 
    const t0 = this.resolveToken(currency0);
    const t1 = this.resolveToken(currency1);
    if (!t0 || !t1) return;
 
    if (!isTrackablePool(t0, t1)) return;
 
    const sides = getPoolSides(t0, t1);
    if (!sides) return;
 
    const exists = await this.poolRepo.findOne({ where: { poolKey: poolId } });
    if (exists) return;
 
    const [fee, tickSpacing, hooks] =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint24', 'int24', 'address', 'uint160', 'int24'],
        log.data
      );
 
      const pool =  await this.poolRepo.save({
      dex:               DexType.UNISWAP_V4,
      chainId:           Chain.ETHEREUM,
      poolKey:           poolId,
      token0:            t0,
      token1:            t1,
      fee:               Number(fee),
      tickSpacing:       Number(tickSpacing),
      hooks,
      quoteTokenAddress: sides.quote.address.toLowerCase(),
      isActive:          true,
    });
    await this.autoMapper.mapPoolsV4([pool]);

    this.logger.log(
      `✅ V4 ${sides.base.symbol}/${sides.quote.symbol} fee=${fee}`
    );
  }
 
  private resolveToken(raw: string): Token | null {
    try {
      return this.tokensByAddress.get(ethers.getAddress(raw).toLowerCase()) ?? null;
    } catch {
      return null;
    }
  }

  async listen() {
    await this.init();
 
    const provider = this.provider.getProvider();
 
    provider.on(
      { address: process.env.UNISWAP_V4_POOL_MANAGER, topics: [INIT_EVENT_TOPIC] },
      async (log) => {
        try { await this.processLog(log); }
        catch (err) { this.logger.error('Init event error', err); }
      }
    );
 
    this.logger.log('👂 V4 listening for new pools');
  }

  
}












/* For all pairs stored in our DB*/


// import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
// import { Injectable, Logger } from "@nestjs/common";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { ethers } from "ethers";

// import { Chain, DexType } from "@/ingestion/onchain/common/chain.enum";
// import { EthereumProvider } from "@/ingestion/onchain/providers/ethereum.provider";
// import { Token } from "@/ingestion/onchain/common/entities/token.entity";

// // ✅ CORRECT: Only non-indexed params in the signature string for ethers.id()
// // The event: Initialize(bytes32 indexed poolId, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks)
// // ethers.id() always uses the full param types (indexed keyword is ignored in the hash)
// const INIT_EVENT_TOPIC = ethers.id(
//   "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
// );

// // Native ETH is represented as zero address in Uniswap V4
// const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

// @Injectable()
// export class UniswapV4DiscoveryService {
//   private logger = new Logger(UniswapV4DiscoveryService.name);
//   private tokensByAddress = new Map<string, Token>();

//   constructor(
//     private readonly provider: EthereumProvider,

//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,

//     @InjectRepository(Token)
//     private tokenRepo: Repository<Token>,
//   ) { }

//   async init() {
//     // await this.tokenRepo.save({
//     //   chain: "ETH",
//     //   chainId: 1,
//     //   address: NATIVE_ETH_ADDRESS,
//     //   symbol: "ETH",
//     //   canonicalSymbol: "ETH",
//     //   decimals: 18,
//     // });

//     const allTokens = await this.tokenRepo.find();
//     allTokens.forEach(t =>
//       this.tokensByAddress.set(t.address.toLowerCase(), t)
//     );

//     this.logger.log(`📋 Loaded ${this.tokensByAddress.size} tokens from DB`);

//     // Warn if native ETH is missing — most common cause of dropped pools
//     if (!this.tokensByAddress.has("0x0000000000000000000000000000000000000000")) {
//       this.logger.warn("⚠️ Native ETH (0x000...000) not in token table — ETH pairs will be skipped. Run TokenSyncService first.");
//     }
//     await this.backfill(21688329);
//     this.listen();
//   }

//   private resolveToken(rawAddress: string): Token | null {
//     try {
//       const address = ethers.getAddress(rawAddress).toLowerCase();
//       return this.tokensByAddress.get(address) ?? null;
//     } catch {
//       return null;
//     }
//   }

//   async backfill(fromBlock: number) {
//     // const provider = this.provider.getProvider();
//     const provider = new ethers.JsonRpcProvider("https://damp-responsive-patina.quiknode.pro/74d8bb211b35da533b021e761c494bfc957e5a30/");
//     const latestBlock = await provider.getBlockNumber();

//     // ✅ FIX: Reasonable chunk size — not 8!
//     const CHUNK = 2000;

//     let start = fromBlock;
//     this.logger.log("🚀 V4 backfill started");
//     console.log("proo", provider, INIT_EVENT_TOPIC)
//     while (start <= latestBlock) {
//       const end = Math.min(start + CHUNK - 1, latestBlock);
//       this.logger.log(`📦 scanning ${start} → ${end}`);

//       try {
//         const logs = await provider.getLogs({
//           address: process.env.UNISWAP_V4_POOL_MANAGER,
//           fromBlock: start,
//           toBlock: end,
//           topics: [INIT_EVENT_TOPIC],
//         });

//         this.logger.log(`📊 logs found: ${logs.length}`);

//         for (const log of logs) {
//           await this.processLog(log);
//         }
//       } catch (err) {
//         this.logger.error(`❌ chunk failed ${start}-${end}`, err);
//         // Optional: add a small delay before retrying on RPC errors
//         await new Promise((r) => setTimeout(r, 500));
//       }

//       start = end + 1;
//     }

//     this.logger.log("✅ V4 backfill completed");
//   }

//   listen() {
//     const provider = new ethers.JsonRpcProvider("https://damp-responsive-patina.quiknode.pro/74d8bb211b35da533b021e761c494bfc957e5a30/");

//     provider.on(
//       {
//         address: process.env.UNISWAP_V4_POOL_MANAGER,
//         topics: [INIT_EVENT_TOPIC],
//       },
//       async (log) => {
//         try {
//           await this.processLog(log);
//         } catch (err) {
//           this.logger.error("Init event error", err);
//         }
//       }
//     );

//     this.logger.log("👂 V4 listening via raw logs");
//   }

//   // ✅ FIX: Centralized log decoder — reads indexed params from topics, non-indexed from data
//   private async processLog(log: ethers.Log) {
//     /*
//     event Initialize(
//     PoolId indexed id,
//     Currency indexed currency0,    // topics[2]
//     Currency indexed currency1,    // topics[3]
//     uint24 fee,                    // data
//     int24 tickSpacing,             // data
//     IHooks hooks,                  // data
//     uint160 sqrtPriceX96,          // data  ← you were missing this
//     int24 tick                     // data  ← and this
// );
//     */

//     // ✅ Indexed params come from topics (already ABI-encoded as 32 bytes each)
//     const poolId = log.topics[1];

//     // topics entries are 32-byte hex; for addresses, take the last 20 bytes
//     const currency0 = ethers.getAddress("0x" + log?.topics[2]?.slice(26));
//     const currency1 = ethers.getAddress("0x" + log?.topics[3]?.slice(26));

//     // ✅ Both tokens must be in our DB — no hardcoded symbol/address lists
//     const t0 = this.resolveToken(currency0);
//     const t1 = this.resolveToken(currency1);

//     if (!t0 || !t1) return; // one or both tokens not tracked — skip silently
//     const exists = await this.poolRepo.findOne({ where: { poolKey: poolId } });
//     if (exists) return;



//     // ✅ Non-indexed params decoded from log.data
//     const [fee, tickSpacing, hooks, sqrtPriceX96, tick] =
//       ethers.AbiCoder.defaultAbiCoder().decode(
//         ["uint24", "int24", "address", "uint160", "int24"],
//         log.data
//       );

//     this.logger.debug(
//       `🔍 Raw event — poolId: ${poolId}, currency0: ${currency0}, currency1: ${currency1}, fee: ${fee}`
//     );

//     await this.savePool(t0, t1, fee, tickSpacing, hooks, poolId);
//   }

//   private async savePool(
//     token0: Token,
//     token1: Token,
//     fee: bigint,
//     tickSpacing: bigint,
//     hooks: string,
//     poolId: string
//   ) {
  

//     await this.poolRepo.save({
//       dex: DexType.UNISWAP_V4,
//       chainId: Chain.ETHEREUM,
//       poolKey: poolId,
//       token0,
//       token1,
//       fee: Number(fee),
//       tickSpacing: Number(tickSpacing),
//       hooks,
//       isActive: true,
//     });

//     this.logger.log(  `✅ ${token0.canonicalSymbol ?? token0.symbol}/${token1.canonicalSymbol ?? token1.symbol} ` +
//     `fee=${fee} hooks=${hooks === ethers.ZeroAddress ? "none" : hooks.slice(0, 10) + "..."}`);
//   }
// }
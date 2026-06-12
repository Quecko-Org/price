// ============================================================
// uniswapv4-pool-scanner.ts
//
// ADDED: Block tracking via chain_sync_state table.
//   - On first run: starts from V4 deploy block
//   - On restart:   resumes from last_scanned_block in DB
//   - After each chunk: updates last_scanned_block
//   - On completion: sets last_scanned_block = latest block
//
// This prevents re-scanning millions of blocks on every restart.
// ============================================================
import { DexPool } from "@/ingestion/onchain/common/entities/pool.entityt";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ethers } from "ethers";
import { Chain, DexType, CHAIN_CONFIGS } from "@/ingestion/onchain/common/chain.config";
import { Token } from "@/ingestion/onchain/common/entities/token.entity";
import { DexAutoMapperService } from "@/ingestion/onchain/common/ingestion-cron/token-syncing/dex-auto-mapper.service";
import { ChainSyncStateEntity } from "@/ingestion/onchain/common/entities/chain-sync-state";

const INIT_EVENT_TOPIC = ethers.id(
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
);

// V4 deployment blocks — where to START if DB has no state
const V4_DEPLOY_BLOCKS: Partial<Record<Chain, number>> = {
  [Chain.ETHEREUM]: 21688329,
  [Chain.BASE]:     22800000,
  [Chain.ARBITRUM]: 275000000,
  [Chain.OPTIMISM]: 128000000,
  [Chain.POLYGON]:  68000000,
};

 

const CHUNK_SIZE = 2000; // blocks per getLogs call

@Injectable()
export class UniswapV4DiscoveryService {
  private readonly logger = new Logger(UniswapV4DiscoveryService.name);

  private tokenMaps = new Map<Chain, Map<string, Token>>();
  private loaded    = new Set<Chain>();

  constructor(
    @InjectRepository(DexPool)             private poolRepo:      Repository<DexPool>,
    @InjectRepository(Token)               private tokenRepo:     Repository<Token>,
    @InjectRepository(ChainSyncStateEntity) private syncRepo:     Repository<ChainSyncStateEntity>,
    private readonly autoMapper: DexAutoMapperService,
  ) {}

  // ── Load token map for one chain ─────────────────────────────
  async init(chainId: Chain) {
    if (this.loaded.has(chainId)) return;

    const tokens = await this.tokenRepo.find({ where: { chainId } });
    const map    = new Map<string, Token>();
    tokens.forEach(t => map.set(t.address.toLowerCase(), t));

    this.tokenMaps.set(chainId, map);
    this.loaded.add(chainId);

    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`📋 ${config.name} V4: ${map.size} tokens loaded`);

    if (!map.has("0x0000000000000000000000000000000000000000")) {
      this.logger.warn(`${config.name}: native token missing — ETH/BNB pools skipped`);
    }
  }

  async refreshTokenMap(chainId: Chain) {
    this.loaded.delete(chainId);
    await this.init(chainId);
  }

  // ── Live Initialize event listener ───────────────────────────
  async listen(chainId: Chain, provider: ethers.WebSocketProvider) {
    await this.init(chainId);
    const config = CHAIN_CONFIGS[chainId];

    provider.on(
      { address: config.uniswapV4PoolManager, topics: [INIT_EVENT_TOPIC] },
      async (log) => {
        try { await this.processLog(log, chainId); }
        catch (err) { this.logger.error(`${config.name} Init event error`, err); }
      }
    );

    this.logger.log(`👂 ${config.name} V4 listening for new pools`);
  }


async backfill(chainId: Chain, provider: ethers.WebSocketProvider): Promise<void> {
  await this.init(chainId);
let p= new ethers.JsonRpcProvider("https://damp-responsive-patina.quiknode.pro/74d8bb211b35da533b021e761c494bfc957e5a30/")
  const config      = CHAIN_CONFIGS[1];
  const deployBlock = V4_DEPLOY_BLOCKS[chainId];

  if (!deployBlock) {
    this.logger.warn(`${config.name}: no V4 deploy block — skipping backfill`);
    return;
  }

  let syncState = await this.syncRepo.findOne({ where: { chainId } });

  if (!syncState) {
    syncState = this.syncRepo.create({
      chainId,
      deployBlock,
      lastScannedBlock: deployBlock - 1,
    });
    await this.syncRepo.save(syncState);
    this.logger.log(`${config.name} V4: first run — scanning from block ${deployBlock}`);
  } else {
    this.logger.log(`${config.name} V4: resuming from block ${Number(syncState.lastScannedBlock) + 1}`);
  }

  // FIX: Number() cast — pg bigint comes back as string, + would concatenate
  const startBlock = Number(syncState.lastScannedBlock) + 1;
  const latest     = await p.getBlockNumber();

  if (startBlock > latest) {
    this.logger.log(`${config.name} V4: already up to date (block ${latest})`);
    return;
  }

  const totalBlocks = latest - startBlock;
  const totalChunks = Math.ceil(totalBlocks / CHUNK_SIZE);
  this.logger.log(
    `🚀 ${config.name} V4 backfill: ${startBlock} → ${latest} ` +
    `(${totalBlocks.toLocaleString()} blocks, ~${totalChunks} chunks)`
  );

  let start      = startBlock;
  let poolsFound = 0;

  while (start <= latest) {
    const end = Math.min(start + CHUNK_SIZE - 1, latest);

    try {
      const logs = await p.getLogs({
        address:   config.uniswapV4PoolManager,
        fromBlock: start,
        toBlock:   end,
        topics:    [INIT_EVENT_TOPIC],
      });

      if (logs.length) {
        console.log("logs.length",start,end)
        this.logger.log(`📦 ${config.name} ${start}→${end}: ${logs.length} pools`);
        poolsFound += logs.length;
      }

      for (const log of logs) {
        await this.processLog(log, chainId);
      }

      // FIX: cast end to number before saving
      syncState.lastScannedBlock = end;
      await this.syncRepo.save(syncState);

    } catch (err: any) {
      this.logger.error(`${config.name} chunk ${start}→${end} failed: ${err?.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }

    start = end + 1;
  }

  this.logger.log(`✅ ${config.name} V4 backfill complete — at block ${latest}, ${poolsFound} pools`);
}

  // ── Process one Initialize log ────────────────────────────────
  async processLog(log: ethers.Log, chainId: Chain) {
    const poolId = log.topics[1];

    const exists = await this.poolRepo.findOne({ where: { poolKey: poolId, chainId } });
    if (exists) return;

    const currency0 = ethers.getAddress("0x" + log.topics[2].slice(26));
    const currency1 = ethers.getAddress("0x" + log.topics[3].slice(26));

    const tokenMap = this.tokenMaps.get(chainId);
    if (!tokenMap) return;

    const t0 = tokenMap.get(currency0.toLowerCase()) ?? null;
    const t1 = tokenMap.get(currency1.toLowerCase()) ?? null;
    if (!t0 || !t1) return;

    // At least one token must be a known quote token for this chain
    const config     = CHAIN_CONFIGS[chainId];
    const t0IsQuote  = config.quoteAddresses.has(t0.address.toLowerCase());
    const t1IsQuote  = config.quoteAddresses.has(t1.address.toLowerCase());
    if (!t0IsQuote && !t1IsQuote) return;

    const [fee, tickSpacing, hooks] =
      ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint24", "int24", "address", "uint160", "int24"],
        log.data
      );

    const pool = await this.poolRepo.save({
      dex:         DexType.UNISWAP_V4,
      chainId,
      poolKey:     poolId,
      token0:      t0,
      token1:      t1,
      fee:         Number(fee),
      tickSpacing: Number(tickSpacing),
      hooks,
      isActive:    true,
    });

    await this.autoMapper.mapPoolsV4([pool]);

    this.logger.log(`✅ [${config.name}] V4 ${t0.symbol}/${t1.symbol} fee=${fee}`);
  }
}









//without multichain
// @Injectable()
// export class UniswapV4DiscoveryService {
//   private logger = new Logger(UniswapV4DiscoveryService.name);
//   private tokensByAddress = new Map<string, Token>();
//   private tokensLoaded    = false;

//   constructor(
//     private readonly provider: EthereumProvider,

//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,

//     @InjectRepository(Token)
//     private tokenRepo: Repository<Token>,
//     private readonly autoMapper: DexAutoMapperService,
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

//     if (this.tokensLoaded) return;
 
//     const allTokens = await this.tokenRepo.find();
//     allTokens.forEach(t =>
//       this.tokensByAddress.set(t.address.toLowerCase(), t)
//     );
 
//     this.tokensLoaded = true;
//     this.logger.log(`📋 Loaded ${this.tokensByAddress.size} tokens`);
 
//     if (!this.tokensByAddress.has(NATIVE_ETH_ADDRESS)) {
//       this.logger.warn(
//         '⚠️  Native ETH (0x000...000) missing — ETH/token V4 pools will be skipped'
//       );
//     }
  
//   }

//   async backfill(fromBlock: number) {
//     await this.init();
//     const provider = new ethers.JsonRpcProvider("https://damp-responsive-patina.quiknode.pro/74d8bb211b35da533b021e761c494bfc957e5a30/");

//     // const provider   = this.provider.getProvider();
//     const latestBlock = await provider.getBlockNumber();
// //     const latestBlock = await provider.getBlockNumber();

//     const CHUNK = 2000;
//     let   start = fromBlock;
 
//     this.logger.log(`🚀 V4 backfill: block ${fromBlock} → ${latestBlock}`);
 
//     while (start <= latestBlock) {
//       const end = Math.min(start + CHUNK - 1, latestBlock);
 
//       try {
//         const logs = await provider.getLogs({
//           address:   process.env.UNISWAP_V4_POOL_MANAGER,
//           fromBlock: start,
//           toBlock:   end,
//           topics:    [INIT_EVENT_TOPIC],
//         });
 
//         if (logs.length) this.logger.log(`📦 ${start}→${end}: ${logs.length} pools`);
//         for (const log of logs) await this.processLog(log);
 
//       } catch (err) {
//         this.logger.error(`❌ chunk ${start}-${end} failed`, err);
//         await new Promise(r => setTimeout(r, 500));
//       }
 
//       start = end + 1;
//     }
 
//     this.logger.log('✅ V4 backfill complete');
//   }
 
//   // ------------------------------------------------------------------
//   // LOG DECODER (shared by listener + backfill)
//   // ------------------------------------------------------------------
//   async processLog(log: ethers.Log) {
//     const poolId    = log.topics[1];
//     const currency0 = ethers.getAddress('0x' + log.topics[2].slice(26));
//     const currency1 = ethers.getAddress('0x' + log.topics[3].slice(26));
 
//     const t0 = this.resolveToken(currency0);
//     const t1 = this.resolveToken(currency1);
//     if (!t0 || !t1) return;
 
//     if (!isTrackablePool(t0, t1)) return;
 
//     const sides = getPoolSides(t0, t1);
//     if (!sides) return;
 
//     const exists = await this.poolRepo.findOne({ where: { poolKey: poolId } });
//     if (exists) return;
 
//     const [fee, tickSpacing, hooks] =
//       ethers.AbiCoder.defaultAbiCoder().decode(
//         ['uint24', 'int24', 'address', 'uint160', 'int24'],
//         log.data
//       );
 
//       const pool =  await this.poolRepo.save({
//       dex:               DexType.UNISWAP_V4,
//       chainId:           Chain.ETHEREUM,
//       poolKey:           poolId,
//       token0:            t0,
//       token1:            t1,
//       fee:               Number(fee),
//       tickSpacing:       Number(tickSpacing),
//       hooks,
//       quoteTokenAddress: sides.quote.address.toLowerCase(),
//       isActive:          true,
//     });
//     await this.autoMapper.mapPoolsV4([pool]);

//     this.logger.log(
//       `✅ V4 ${sides.base.symbol}/${sides.quote.symbol} fee=${fee}`
//     );
//   }
 
//   private resolveToken(raw: string): Token | null {
//     try {
//       return this.tokensByAddress.get(ethers.getAddress(raw).toLowerCase()) ?? null;
//     } catch {
//       return null;
//     }
//   }

//   async listen() {
//     await this.init();
 
//     const provider = this.provider.getProvider();
 
//     provider.on(
//       { address: process.env.UNISWAP_V4_POOL_MANAGER, topics: [INIT_EVENT_TOPIC] },
//       async (log) => {
//         try { await this.processLog(log); }
//         catch (err) { this.logger.error('Init event error', err); }
//       }
//     );
 
//     this.logger.log('👂 V4 listening for new pools');
//   }

  
// }












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
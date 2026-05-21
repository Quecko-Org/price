// ============================================================
// uniswap-pool-scanner.service.ts  (UniswapDiscoveryService)
//
// SIMPLIFIED — no getPoolSides, no quoteTokenAddress.
//
// Discovery only needs to:
//   1. Find which pool address exists for a token pair
//   2. Save the pool with token0/token1 in sorted order (Uniswap rule)
//   3. Let DexAutoMapperService handle market mapping
//
// Sorting IS still required here because factory.getPool() only
// returns the address when called with token0 < token1.
// It does NOT affect price direction — that's handled by baseIsToken0
// stored in dex_market_maps at mapping time.
// ============================================================
import { InjectRepository } from "@nestjs/typeorm";
import { DexPool } from "../../../common/entities/pool.entityt";
import { Repository } from "typeorm";
import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { UNISWAP3_FACTORY_ABI } from "../../../common/abi/uniswap.abi";
import { Token } from "../../../common/entities/token.entity";
import { Chain, DexType, CHAIN_CONFIGS } from "@/ingestion/onchain/common/chain.config";

const FEES = [500, 3000, 10000];

@Injectable()
export class UniswapDiscoveryService {
  private readonly logger = new Logger(UniswapDiscoveryService.name);

  constructor(
    @InjectRepository(Token)   private tokenRepo: Repository<Token>,
    @InjectRepository(DexPool) private poolRepo:  Repository<DexPool>,
  ) {}

  async discover(chainId: Chain, provider: ethers.WebSocketProvider) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`🔍 ${config.name} V3 discovery...`);

    const allTokens = await this.tokenRepo.find({ where: { chainId } });
    if (!allTokens.length) {
      this.logger.warn(`${config.name}: no tokens in DB — run TokenSyncService first`);
      return;
    }

    // Split into base and quote using chain-specific addresses
    // Quote tokens = stables + wrapped natives defined in chain config
    const quoteTokens = allTokens.filter(t =>
      config.quoteAddresses.has(t.address.toLowerCase())
    );
    const baseTokens = allTokens.filter(t =>
      !config.quoteAddresses.has(t.address.toLowerCase())
    );

    // quote × quote pairs (WETH/USDC, WBTC/USDT, WETH/WBTC etc.)
    const quotePairs: [Token, Token][] = [];
    for (let i = 0; i < quoteTokens.length; i++) {
      for (let j = i + 1; j < quoteTokens.length; j++) {
        quotePairs.push([quoteTokens[i], quoteTokens[j]]);
      }
    }

    this.logger.log(
      `${config.name}: ${baseTokens.length} base × ${quoteTokens.length} quote ` +
      `+ ${quotePairs.length} quote/quote pairs`
    );

    const factory = new ethers.Contract(
      config.uniswapV3Factory,
      UNISWAP3_FACTORY_ABI,
      provider,
    );

    let discovered = 0;

    for (const base of baseTokens) {
      for (const quote of quoteTokens) {
        if (await this.checkAndSave(factory, base, quote, chainId)) discovered++;
      }
    }

    for (const [a, b] of quotePairs) {
      if (await this.checkAndSave(factory, a, b, chainId)) discovered++;
    }

    this.logger.log(`✅ ${config.name} V3: ${discovered} new pools`);
  }

  private async checkAndSave(
    factory:  ethers.Contract,
    tokenA:   Token,
    tokenB:   Token,
    chainId:  Chain,
  ): Promise<boolean> {
    if (tokenA.address === tokenB.address) return false;

    // ✅ Sort ONLY because factory.getPool() requires token0 < token1
    // This does NOT determine price direction — that's in dex_market_maps.baseIsToken0
    let token0 = tokenA, token1 = tokenB;
    if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
      [token0, token1] = [token1, token0];
    }

    let saved = false;

    for (const fee of FEES) {
      try {
        const poolKey = await factory.getPool(token0.address, token1.address, fee);
        if (!poolKey || poolKey === ethers.ZeroAddress) continue;

        // Check by poolKey + chainId — same address can't exist on two chains
        const exists = await this.poolRepo.exists({ where: { poolKey, chainId } });
        if (exists) continue;

        await this.poolRepo.save({
          dex:      DexType.UNISWAP_V3,
          chainId,
          poolKey,
          token0,   // sorted: token0.address < token1.address
          token1,
          fee,
          isActive: true,
          // ✅ No quoteTokenAddress — direction stored in dex_market_maps.baseIsToken0
        });

        this.logger.log(
          `✅ [${CHAIN_CONFIGS[chainId].name}] ` +
          `${token0.symbol}/${token1.symbol} fee=${fee}`
        );
        saved = true;

      } catch (_) {
        // getPool reverts for non-existent pairs — expected, not an error
      }
    }

    return saved;
  }
}




// @Injectable()
// export class UniswapDiscoveryService {

//   private logger = new Logger(UniswapDiscoveryService.name);

//   constructor(
//     private readonly provider: EthereumProvider,

//     @InjectRepository(Token)
//     private tokenRepo: Repository<Token>,

//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,
//   ) { }


//   async discover() {
//     this.logger.log("🔍 Discovering Uniswap V3 pools...");
  
//     const allTokens = await this.tokenRepo.find();
  
//     // ✅ Split using the same isQuoteToken() from pool-filter
//     // — single source of truth, no hardcoded symbol lists here
//     const quoteTokens = allTokens.filter(t => isQuoteToken(t));
//     const baseTokens  = allTokens.filter(t => !isQuoteToken(t));
  
//     this.logger.log(
//       `📊 ${allTokens.length} tokens → ${baseTokens.length} base × ${quoteTokens.length} quote`
//     );
   
//     // Also check quote×quote pairs (e.g. WETH/USDC, WBTC/USDC)
//     // These are real high-volume pools you'd otherwise miss
//     const quotePairs: [Token, Token][] = [];
//     for (let i = 0; i < quoteTokens.length; i++) {
//       for (let j = i + 1; j < quoteTokens.length; j++) {
//         quotePairs.push([quoteTokens[i], quoteTokens[j]]);
//       }
//     }
  
//     this.logger.log(`🔗 ${baseTokens.length * quoteTokens.length} base/quote + ${quotePairs.length} quote/quote pairs`);
  
//     const contract = new ethers.Contract(
//       process.env.UNISWAP_FACTORY!,
//       UNISWAP3_FACTORY_ABI,
//       this.provider.getProvider()
//     );
  
//     // ── base × quote pairs ──────────────────────────────────────
//     for (const base of baseTokens) {
//       for (const quote of quoteTokens) {
//         await this.checkAndSave(contract, base, quote);
//       }
//     }
  
//     // ── quote × quote pairs (WETH/USDC, WBTC/USDC etc.) ────────
//     for (const [a, b] of quotePairs) {
//       await this.checkAndSave(contract, a, b);
//     }
  
//     this.logger.log("✅ V3 discovery complete");
//   }
  
//   private async checkAndSave(
//     contract: ethers.Contract,
//     tokenA: Token,
//     tokenB: Token,
//   ) {
//     // Sort addresses — Uniswap requires token0 < token1
//     let token0 = tokenA;
//     let token1 = tokenB;
//     if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
//       [token0, token1] = [token1, token0];
//     }
  
//     const sides = getPoolSides(token0, token1);
//     if (!sides) return;
  
//     for (const fee of FEES) {
//       try {
//         const poolKey = await contract.getPool(token0.address, token1.address, fee);
//         if (!poolKey || poolKey === ethers.ZeroAddress) continue;
  
//         const exists = await this.poolRepo.exists({ where: { poolKey } });
//         if (exists) continue;
  
//         await this.poolRepo.save({
//           dex:               DexType.UNISWAP_V3,
//           chainId:           Chain.ETHEREUM,
//           poolKey,
//           token0,
//           token1,
//           fee,
//           quoteTokenAddress: sides.quote.address.toLowerCase(),
//           isActive:          true,
//         });
  
//         this.logger.log(`✅ ${sides.base.symbol}/${sides.quote.symbol} fee=${fee}`);
  
//       } catch (_) {}
//     }
//   }
// }











/* stable coin as a quoute above is with sharing filter can be used by v4 */
// import { InjectRepository } from "@nestjs/typeorm";
// import { EthereumProvider } from "../../../providers/ethereum.provider";
// import { DexPool } from "../../../common/entities/pool.entityt";
// import { Repository } from "typeorm";
// import { Injectable, Logger } from "@nestjs/common";
// import { ethers } from "ethers";
// import { UNISWAP3_FACTORY_ABI } from "../../../common/abi/uniswap.abi";

// import { Token } from "../../../common/entities/token.entity";
// import { STABLES, WRAPPED } from "../../../common/common-tokens";
// import { Chain, DexType } from "@/ingestion/onchain/common/chain.enum";



// const FEES = [500, 3000, 10000];

// @Injectable()
// export class UniswapDiscoveryService {

//   private logger = new Logger(UniswapDiscoveryService.name);

//   constructor(
//     private readonly provider: EthereumProvider,

//     @InjectRepository(Token)
//     private tokenRepo: Repository<Token>,

//     @InjectRepository(DexPool)
//     private poolRepo: Repository<DexPool>,
//   ) { }


//   async discover() {

//     this.logger.log("🔍 Discovering Uniswap pools...");

//     const allTokens = await this.tokenRepo.find();

//     // ✅ Split tokens
//     const baseTokens = allTokens.filter(
//       t => !STABLES.includes(t.symbol)
//     );



//     const quoteTokens = allTokens.filter(
//       t => STABLES.includes(t.symbol) || WRAPPED.includes(t.symbol)
//     );
//     // console.log("baseToken",baseTokens,quoteTokens)
//     const contract = new ethers.Contract(
//       process.env.UNISWAP_FACTORY!,
//       UNISWAP3_FACTORY_ABI,
//       this.provider.getProvider()
//     );

//     for (const base of baseTokens) {
//       for (const quote of quoteTokens) {
     
//         if (base.address === quote.address) continue;

//         // ✅ Sort addresses (CRITICAL for Uniswap)
//         let token0 = base;
//         let token1 = quote;

//         if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
//           [token0, token1] = [token1, token0];
//         }

//         for (const fee of FEES) {
//           try {
//             const poolKey = await contract.getPool(
//               token0.address,
//               token1.address,
//               fee
//             );

//             if (!poolKey || poolKey === ethers.ZeroAddress) continue;

//             const exists = await this.poolRepo.exists({
//               where: { poolKey }
//             });

//             if (exists) continue;

//             await this.poolRepo.save({
//               dex: DexType.UNISWAP_V3,
//               chain: Chain.ETHEREUM,
//               poolKey,
//               token0,
//               token1,
//               fee,
//               isActive: true,
//             });

//             this.logger.log(`✅ Pool: ${token0.symbol}/${token1.symbol}`);

//           } catch (err) { }
//         }
//       }
//     }
//   }
// }

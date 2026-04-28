import { InjectRepository } from "@nestjs/typeorm";
import { EthereumProvider } from "../../../providers/ethereum.provider";
import { DexPool } from "../../../common/entities/pool.entityt";
import { Repository } from "typeorm";
import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { UNISWAP3_FACTORY_ABI } from "../../../common/abi/uniswap.abi";

import { Token } from "../../../common/entities/token.entity";
import { Chain, DexType } from "@/ingestion/onchain/common/chain.enum";
import { getPoolSides, isQuoteToken, isTrackablePool } from "../base/pool-filter";



const FEES = [500, 3000, 10000];

@Injectable()
export class UniswapDiscoveryService {

  private logger = new Logger(UniswapDiscoveryService.name);

  constructor(
    private readonly provider: EthereumProvider,

    @InjectRepository(Token)
    private tokenRepo: Repository<Token>,

    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,
  ) { }


  async discover() {
    this.logger.log("🔍 Discovering Uniswap V3 pools...");
  
    const allTokens = await this.tokenRepo.find();
  
    // ✅ Split using the same isQuoteToken() from pool-filter
    // — single source of truth, no hardcoded symbol lists here
    const quoteTokens = allTokens.filter(t => isQuoteToken(t));
    const baseTokens  = allTokens.filter(t => !isQuoteToken(t));
  
    this.logger.log(
      `📊 ${allTokens.length} tokens → ${baseTokens.length} base × ${quoteTokens.length} quote`
    );
  
    // Also check quote×quote pairs (e.g. WETH/USDC, WBTC/USDC)
    // These are real high-volume pools you'd otherwise miss
    const quotePairs: [Token, Token][] = [];
    for (let i = 0; i < quoteTokens.length; i++) {
      for (let j = i + 1; j < quoteTokens.length; j++) {
        quotePairs.push([quoteTokens[i], quoteTokens[j]]);
      }
    }
  
    this.logger.log(`🔗 ${baseTokens.length * quoteTokens.length} base/quote + ${quotePairs.length} quote/quote pairs`);
  
    const contract = new ethers.Contract(
      process.env.UNISWAP_FACTORY!,
      UNISWAP3_FACTORY_ABI,
      this.provider.getProvider()
    );
  
    // ── base × quote pairs ──────────────────────────────────────
    for (const base of baseTokens) {
      for (const quote of quoteTokens) {
        await this.checkAndSave(contract, base, quote);
      }
    }
  
    // ── quote × quote pairs (WETH/USDC, WBTC/USDC etc.) ────────
    for (const [a, b] of quotePairs) {
      await this.checkAndSave(contract, a, b);
    }
  
    this.logger.log("✅ V3 discovery complete");
  }
  
  private async checkAndSave(
    contract: ethers.Contract,
    tokenA: Token,
    tokenB: Token,
  ) {
    // Sort addresses — Uniswap requires token0 < token1
    let token0 = tokenA;
    let token1 = tokenB;
    if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
      [token0, token1] = [token1, token0];
    }
  
    const sides = getPoolSides(token0, token1);
    if (!sides) return;
  
    for (const fee of FEES) {
      try {
        const poolKey = await contract.getPool(token0.address, token1.address, fee);
        if (!poolKey || poolKey === ethers.ZeroAddress) continue;
  
        const exists = await this.poolRepo.exists({ where: { poolKey } });
        if (exists) continue;
  
        await this.poolRepo.save({
          dex:               DexType.UNISWAP_V3,
          chainId:           Chain.ETHEREUM,
          poolKey,
          token0,
          token1,
          fee,
          quoteTokenAddress: sides.quote.address.toLowerCase(),
          isActive:          true,
        });
  
        this.logger.log(`✅ ${sides.base.symbol}/${sides.quote.symbol} fee=${fee}`);
  
      } catch (_) {}
    }
  }
}











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

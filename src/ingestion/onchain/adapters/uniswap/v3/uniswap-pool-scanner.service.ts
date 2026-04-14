import { InjectRepository } from "@nestjs/typeorm";
import { EthereumProvider } from "../../../providers/ethereum.provider";
import { DexPool } from "../../../common/entities/pool.entityt";
import { Repository } from "typeorm";
import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { UNISWAP3_FACTORY_ABI } from "../../../common/abi/uniswap.abi";

import { Token } from "../../../common/entities/token.entity";
import { STABLES, WRAPPED } from "../../../common/common-tokens";



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

    this.logger.log("🔍 Discovering Uniswap pools...");

    const allTokens = await this.tokenRepo.find();

    // ✅ Split tokens
    const baseTokens = allTokens.filter(
      t => !STABLES.includes(t.symbol)
    );



    const quoteTokens = allTokens.filter(
      t => STABLES.includes(t.symbol) || WRAPPED.includes(t.symbol)
    );
    // console.log("baseToken",baseTokens,quoteTokens)
    const contract = new ethers.Contract(
      process.env.UNISWAP_FACTORY!,
      UNISWAP3_FACTORY_ABI,
      this.provider.getProvider()
    );

    for (const base of baseTokens) {
      for (const quote of quoteTokens) {
     
        if (base.address === quote.address) continue;

        // ✅ Sort addresses (CRITICAL for Uniswap)
        let token0 = base;
        let token1 = quote;

        if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
          [token0, token1] = [token1, token0];
        }

        for (const fee of FEES) {
          try {
            const poolAddress = await contract.getPool(
              token0.address,
              token1.address,
              fee
            );

            if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;

            const exists = await this.poolRepo.exists({
              where: { poolAddress }
            });

            if (exists) continue;

            await this.poolRepo.save({
              dex: "UNISWAP_V3",
              chain: "ETH",
              poolAddress,
              token0,
              token1,
              fee,
              isActive: true,
            });

            this.logger.log(`✅ Pool: ${token0.symbol}/${token1.symbol}`);

          } catch (err) { }
        }
      }
    }
  }
}

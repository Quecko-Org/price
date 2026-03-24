import { InjectRepository } from "@nestjs/typeorm";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { DexPool } from "../../common/entities/pool.entityt";
import { Repository } from "typeorm";
import { Injectable, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import {uniswapv3} from "../../common/configs"
import { UNISWAP3_FACTORY_ABI } from "../../common/abi/uniswap.abi";

import { Token } from "../../common/entities/token.entity";



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
  ) {}

  async discover() {

    this.logger.log("🔍 Discovering Uniswap pools...");

    const tokens = await this.tokenRepo.find();

    const contract = new ethers.Contract(
      uniswapv3.UNISWAP_FACTORY,
        UNISWAP3_FACTORY_ABI,
      this.provider.getProvider()
    );

    for (const t0 of tokens) {
      for (const t1 of tokens) {

        if (t0.id === t1.id) continue;

        for (const fee of FEES) {

          try {
            const poolAddress = await contract.getPool(
              t0.address,
              t1.address,
              fee
            );

            if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;

            const exists = await this.poolRepo.findOne({
              where: { poolAddress }
            });

            if (exists) continue;

            await this.poolRepo.save({
              dex: "UNISWAP_V3",
              chain: "ETH",
              poolAddress,
              token0: t0,
              token1: t1,
              fee,
              isActive: true,
            });

            this.logger.log(`✅ New pool: ${poolAddress}`);

          } catch (err) {}
        }
      }
    }
  }
}

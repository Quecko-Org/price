import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ethers } from "ethers";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DexPool } from "../entities/pool.entityt";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { DexAutoMapperService } from "../token-syncing/dex-auto-mapper.service";
import { TokenSyncService } from "../token-syncing/token-sync.service";
import { UniswapDiscoveryService } from "../../adapters/uniswap/uniswap-pool-scanner.service";


const ABI = ["function liquidity() view returns (uint128)"];

@Injectable()
export class LiquidityUpdaterService {

  constructor(
    private readonly provider: EthereumProvider,

    private readonly tokenSync: TokenSyncService,
    private readonly discovery: UniswapDiscoveryService,
    private readonly autoMapper: DexAutoMapperService,

    

    @InjectRepository(DexPool)
    private poolRepo: Repository<DexPool>,
  ) {}

  @Cron("*/5 * * * *") // every 5 min
  async update() {

    const pools = await this.poolRepo.find();

    for (const p of pools) {

      try {
        const contract = new ethers.Contract(
          p.poolAddress,
          ABI,
          this.provider.getProvider()
        );

        const liq = await contract.liquidity();

        p.liquidityUsd = liq.toString();

      } catch {}

    }

    await this.poolRepo.save(pools);
  }

  @Cron("0 */10 * * * *") // every 10 min
async fullSync() {
  await this.tokenSync.sync();
  await this.discovery.discover();
  await this.autoMapper.map();
}
}
import { Injectable } from "@nestjs/common";
import { TokenSyncService } from "./token-syncing/token-sync.service";
import { UniswapDiscoveryService } from "../../adapters/uniswap/v3/uniswap-pool-scanner.service";
import { DexAutoMapperService } from "./token-syncing/dex-auto-mapper.service";


@Injectable()
export class IngestionCronService {

  constructor(
    private readonly tokenSync: TokenSyncService,
    private readonly discovery: UniswapDiscoveryService,
    private readonly autoMapper: DexAutoMapperService,

  ) { }
 
  async fullSync() {
    console.log("syncingggggg full sync")
    await this.tokenSync.sync();
    await this.discovery.discover();
    await this.autoMapper.map();
    console.log("end syncing")
  }
}
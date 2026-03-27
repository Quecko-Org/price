import { ethers } from "ethers";
import { Injectable } from "@nestjs/common";
import { EthereumProvider } from "../../providers/ethereum.provider";
import { Token } from "../../common/entities/token.entity";
import { DexPool } from "../../common/entities/pool.entityt";
import { UNISWAP3_FACTORY_ABI, UNISWAP3_POOL_ABI } from "../../common/abi/uniswap.abi";

@Injectable()
export class UniswapOnChainService {
  constructor(private readonly ethProvider: EthereumProvider) {}

  async getTopPools(token0: Token, token1: Token, top = 3): Promise<DexPool[]> {
    const provider = this.ethProvider.getProvider();
    const factory = new ethers.Contract(     process.env.UNISWAP_FACTORY || "",
        UNISWAP3_FACTORY_ABI, provider);

    const allPools: string[] = await factory.getPools(token0.address, token1.address);

    const poolsWithLiquidity = await Promise.all(
      allPools.map(async (poolAddr) => {
        const pool = new ethers.Contract(poolAddr, UNISWAP3_POOL_ABI, provider);
        const liquidity = await pool.liquidity();
        return { poolAddr, liquidity };
      })
    );

    // sort descending by liquidity
    poolsWithLiquidity.sort((a, b) => Number(b.liquidity) - Number(a.liquidity));

    return poolsWithLiquidity.slice(0, top).map((p) => ({
      poolAddress: p.poolAddr,
      token0,
      token1,
      liquidity: p.liquidity.toString(),
      dex: "UNISWAP_V3",
      chain: token0.chain,
    } as any));
  }
}
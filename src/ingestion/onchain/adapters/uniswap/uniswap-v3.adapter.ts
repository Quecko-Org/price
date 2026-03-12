import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { UNISWAP_V3_POOL_ABI } from './uniswap-ABI';
import { sqrtPriceX96ToPrice } from './utils';
import { AggregationService } from '@/aggregation/aggregation.service';
import { Chain } from '../../common/chain.enum';
import { Dex } from '../../common/dex.enum';

@Injectable()
export class UniswapV3Listener implements OnModuleInit {
  private readonly logger = new Logger(UniswapV3Listener.name);
  private provider: ethers.WebSocketProvider;

  // Example: ETH/USDC 0.05% mainnet
  private readonly pools = [
    {
      address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      symbol: 'ETH-USDC',
      decimals0: 18,
      decimals1: 6,
    },
  ];

  constructor(
    private readonly aggregationService: AggregationService,
  ) {}

  async onModuleInit() {
    this.provider = new ethers.WebSocketProvider(
      process.env.ETHEREUM_WSS_RPC!,
    );

    for (const pool of this.pools) {
      this.listenToPool(pool);
    }
  }

  private listenToPool(poolConfig: any) {
    const contract = new ethers.Contract(
      poolConfig.address,
      UNISWAP_V3_POOL_ABI,
      this.provider,
    );

    contract.on(
      'Swap',
      async (
        sender,
        recipient,
        amount0,
        amount1,
        sqrtPriceX96,
        liquidity,
        tick,
        event,
      ) => {
        try {
          const block = await event.getBlock();
          const timestamp = block.timestamp;

          const price = sqrtPriceX96ToPrice(
            sqrtPriceX96,
            poolConfig.decimals0,
            poolConfig.decimals1,
          );

          const volume =
            Math.abs(Number(amount0)) / 10 ** poolConfig.decimals0;

        //   this.aggregationService.handleDexTrade({
        //     symbol: poolConfig.symbol,
        //     chain: Chain.ETHEREUM,
        //     dex: Dex.UNISWAP_V3,
        //     poolAddress: poolConfig.address,
        //     price,
        //     volume,
        //     timestamp,
        //   });

        } catch (err) {
          this.logger.error('Swap handling error', err);
        }
      },
    );

    this.logger.log(`Listening to V3 pool: ${poolConfig.symbol}`);
  }
}

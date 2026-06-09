// ============================================================
// onchain.service.ts
//
// ChainProviderFactory.onModuleInit() runs BEFORE this service's
// onModuleInit() (NestJS calls hooks in dependency order).
// By the time onModuleInit() runs here, providers are already
// populated — no need to call chains.init() manually.
//
// Only remaining concern: PriceCacheService may still be empty
// on first boot (no candles in DB yet). We don't block for it —
// pools with 0 liquidity are simply skipped, and they get picked
// up on the next cron cycle once prices flow from CEX streams.
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChainProviderFactory } from './providers/provider.factory';
import { Chain, CHAIN_CONFIGS, getEnabledChains } from './common/chain.config';
import { UniswapV3OnchainService } from './adapters/uniswap/v3/uniswap-onchain.service';
import { UniswapV4OnchainService } from './adapters/uniswap/v4/uniswap-v4.onchain.service';

@Injectable()
export class OnchainService implements OnModuleInit {
  private readonly logger = new Logger(OnchainService.name);

  constructor(
    private readonly chains: ChainProviderFactory,  // already initialized by NestJS
    private readonly v3:     UniswapV3OnchainService,
    private readonly v4:     UniswapV4OnchainService,
  ) {}

  async onModuleInit() {
    this.logger.log('OnchainService: scheduling DEX boot in 1s...');

    // ✅ Tiny delay so app.listen() fires first → APIs available immediately
    // ChainProviderFactory.onModuleInit() already finished by here
    // — providers are populated, no need to call chains.init()
    setTimeout(() => this.bootAllChains(), 1_000);
  }

  private async bootAllChains() {
    try {
      const enabled = getEnabledChains();

      if (!enabled.length) {
        this.logger.warn('No chains configured — set ETH_WS etc. in .env');
        return;
      }

      this.logger.log(`🚀 DEX booting on: ${enabled.map(c => c.name).join(', ')}`);

      await Promise.all(enabled.map(c => this.bootChain(c.chainId)));

      this.logger.log('✅ DEX engine started');

    } catch (err: any) {
      this.logger.error(`DEX boot failed: ${err?.message}`);
    }
  }

  private async bootChain(chainId: Chain) {
    const config   = CHAIN_CONFIGS[chainId];
    const provider = this.chains.get(chainId);

    if (!provider) {
      // Chain timed out or failed during ChainProviderFactory.onModuleInit()
      // The factory's retry logic will reconnect — next cron run will pick it up
      this.logger.warn(`${config.name}: no provider (connection failed or timed out) — skipping`);
      return;
    }

    this.logger.log(`⛓  Booting ${config.name}...`);

    if (config.hasV4 && config.uniswapV4PoolManager) {
      await this.v4.bootChain(chainId, provider);
    }

    await this.v3.bootChain(chainId, provider);

    this.logger.log(`✅ ${config.name} booted`);
  }
}
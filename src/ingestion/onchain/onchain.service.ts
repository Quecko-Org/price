// ============================================================
// onchain.service.ts
//
// ADDED: waitForPrices() before booting DEX chains.
//
// WHY: If DEX starts before CEX has run, priceCache is empty.
// normalizeToUSD() returns null → all pools get liquidityUsd=0
// → no pools marked active → no listeners started.
//
// FIX: PriceCacheService.onModuleInit() warms from DB first.
// Then waitForPrices(30s) ensures at least some prices exist.
// Even on first boot with empty DB, we wait max 30s then start
// anyway (pools will have 0 liquidity until first candle flush).
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChainProviderFactory } from './providers/provider.factory';
import { Chain, CHAIN_CONFIGS, getEnabledChains } from './common/chain.config';
import { UniswapV3OnchainService } from './adapters/uniswap/v3/uniswap-onchain.service';
import { UniswapV4OnchainService } from './adapters/uniswap/v4/uniswap-v4.onchain.service';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';

@Injectable()
export class OnchainService implements OnModuleInit {
  private readonly logger = new Logger(OnchainService.name);

  constructor(
    private readonly chains:     ChainProviderFactory,
    private readonly v3:         UniswapV3OnchainService,
    private readonly v4:         UniswapV4OnchainService,
    private readonly priceCache: PriceCacheService,
  ) {}

  async onModuleInit() {
        await this.chains.init();

    const enabled = getEnabledChains();

    this.logger.log(
      `🚀 DEX engine starting on: ${enabled.map(c => c.name).join(', ')}`
    );

    // ✅ Wait for price cache before starting DEX
    // PriceCacheService.onModuleInit() already ran warmFromDatabase().
    // If DB had candles → pricesLoaded=true → returns immediately.
    // If DB was empty  → waits up to 30s for CEX streams to populate.
    await this.priceCache.waitForPrices(30_000);
console.log("after 30 sec")
    // Boot all chains in parallel
    await Promise.all(enabled.map(c => this.bootChain(c.chainId)));

    this.logger.log('✅ DEX engine fully started');
  }

  private async bootChain(chainId: Chain) {
    const config   = CHAIN_CONFIGS[chainId];
    const provider = this.chains.get(chainId);
console.log("bootChain",chainId,provider)

    if (!provider) {
      this.logger.warn(`${config.name}: no provider — skipping`);
      return;
    }
 
    this.logger.log(`⛓  Booting ${config.name}...`);

    // V4 first (event-driven — must listen before backfill)
    if (config.hasV4 && config.uniswapV4PoolManager) {
      await this.v4.bootChain(chainId, provider);
    }

    // V3 (cron-based discovery)
    await this.v3.bootChain(chainId, provider);

    this.logger.log(`✅ ${config.name} booted`);
  }
}
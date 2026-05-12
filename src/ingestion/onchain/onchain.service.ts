// ============================================================
// onchain.service.ts
//
// Orchestrates boot across ALL enabled chains.
// Delegates to your existing separate service files — does NOT
// absorb their logic.
//
// How multichain works with your existing file structure:
//
//   getEnabledChains() reads env vars at boot:
//     ETH_WS set     → boots Ethereum
//     BSC_WS set     → boots BSC (V3 only, hasV4=false)
//     ARBITRUM_WS set → boots Arbitrum (V3 + V4)
//     (unset)        → chain silently skipped
//
//   Per chain, it calls the SAME V3/V4 onchain services
//   but passes chainId + provider so each service knows
//   which chain it's operating on.
//
// Your existing files stay exactly as they are.
// UniswapV3OnchainService and UniswapV4OnchainService just
// receive chainId/provider as parameters now.
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChainProviderFactory } from './providers/provider.factory';
import { Chain, CHAIN_CONFIGS, getEnabledChains, getV3EnabledChains, getV4EnabledChains } from './common/chain.config';
import { UniswapV3OnchainService } from './adapters/uniswap/v3/uniswap-onchain.service';
import { UniswapV4OnchainService } from './adapters/uniswap/v4/uniswap-v4.onchain.service';

@Injectable()
export class OnchainService implements OnModuleInit {
  private readonly logger = new Logger(OnchainService.name);

  constructor(
    private readonly chains: ChainProviderFactory,
    private readonly v3:     UniswapV3OnchainService,
    private readonly v4:     UniswapV4OnchainService,
  ) {}

  async onModuleInit() {
    const enabled = getEnabledChains();
// console.log("enabled",enabled)
    this.logger.log(
      `🚀 DEX engine starting on ${enabled.length} chain(s): ` +
      enabled.map(c => c.name).join(', ')
    );

    // Boot all chains in parallel — they're independent
    await Promise.all(enabled.map(c => this.bootChain(c.chainId)));

    this.logger.log('✅ DEX engine fully started');
  }

  private async bootChain(chainId: Chain) {
    const config   = CHAIN_CONFIGS[chainId];
    const provider = this.chains.get(chainId);
console.log("chainid",chainId,!provider)
    if (!provider) {
      this.logger.warn(`${config.name}: no provider — skipping`);
      return;
    }

    this.logger.log(`⛓  Booting ${config.name}...`);

    // ── V4 (only if this chain has V4 deployed) ────────────
    if (config.hasV4 && config.uniswapV4PoolManager) {
      // Order matters for V4:
      // 1. Attach Initialize listener FIRST (no pools missed)
      // 2. Load existing DB pools
      // 3. Backfill in background
      // await this.v4.bootChain(chainId, provider);
    } else {
      this.logger.log(`${config.name}: no V4 deployment — skipping V4`);
    }

    // ── V3 (all chains have V3/equivalent) ────────────────
    // discoverAndStart handles: discovery + listener attach + cron
    await this.v3.bootChain(chainId, provider);

    this.logger.log(`✅ ${config.name} booted`);
  }
}
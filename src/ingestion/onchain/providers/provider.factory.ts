// ============================================================
// chain-provider.factory.ts
// Creates and manages one WebSocket provider per enabled chain.
// Auto-reconnects on disconnect (ethers WebSocketProvider drops silently).
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { Chain, ChainConfig, getEnabledChains } from '../common/chain.config';

@Injectable()
export class ChainProviderFactory implements OnModuleInit {
  private readonly logger    = new Logger(ChainProviderFactory.name);
  private providers          = new Map<Chain, ethers.WebSocketProvider>();
  private reconnectTimers    = new Map<Chain, NodeJS.Timeout>();

  async onModuleInit() {
    for (const chain of getEnabledChains()) {
      await this.connect(chain);
    }
  }

  private async connect(chain: ChainConfig) {
    const url = process.env[chain.wsEnvKey];
    if (!url) return;

    try {
      const provider = new ethers.WebSocketProvider(url);

      // Detect silent drops — WebSocket can die without firing 'close'
      const ws = (provider as any).websocket;
      if (ws) {
        ws.on('close', () => {
          this.logger.warn(`${chain.name} WS dropped — reconnecting`);
          this.providers.delete(chain.chainId);
          this.scheduleReconnect(chain);
        });
      }

      this.providers.set(chain.chainId, provider);
      this.logger.log(`✅ ${chain.name} provider connected`);
    } catch (err) {
      this.logger.error(`${chain.name} provider failed`, err);
      this.scheduleReconnect(chain);
    }
  }

  private scheduleReconnect(chain: ChainConfig) {
    if (this.reconnectTimers.has(chain.chainId)) return;
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(chain.chainId);
      await this.connect(chain);
    }, 5_000);
    this.reconnectTimers.set(chain.chainId, timer);
  }

  get(chainId: Chain): ethers.WebSocketProvider | null {
    return this.providers.get(chainId) ?? null;
  }

  getAll(): Map<Chain, ethers.WebSocketProvider> {
    return this.providers;
  }
}
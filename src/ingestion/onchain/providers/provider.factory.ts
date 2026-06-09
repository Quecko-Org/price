// ============================================================
// chain-provider.factory.ts
//
// onModuleInit() AWAITS all chain connections — but each chain
// has a 10s timeout so one bad chain can't block forever.
// Total worst-case: 10s × N chains (run in parallel = just 10s).
//
// OnchainService.bootAllChains() runs AFTER onModuleInit() finishes,
// so providers are guaranteed to be populated (or timed out) by then.
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { Chain, ChainConfig, getEnabledChains } from '../common/chain.config';

const MAX_RETRIES        = 5;
const HANDSHAKE_TIMEOUT  = 10_000; // 10s per chain

@Injectable()
export class ChainProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(ChainProviderFactory.name);

  private providers       = new Map<Chain, ethers.WebSocketProvider>();
  private reconnectTimers = new Map<Chain, NodeJS.Timeout>();
  private retryCount      = new Map<Chain, number>();
  private heartbeats      = new Map<Chain, NodeJS.Timeout>();

  // ── NestJS calls this automatically ──────────────────────────
  // Awaits all chain connections (parallel, 10s timeout each).
  // Returns when all chains have either connected or timed out.
  // OnchainService.onModuleInit() runs AFTER this completes,
  // so providers are ready when bootAllChains() is called.
  async onModuleInit() {
    const chains = getEnabledChains();

    if (!chains.length) {
      this.logger.warn('No chains enabled — set ETH_WS / BSC_WS etc. in .env');
      return;
    }

    this.logger.log(
      `🔌 Connecting to ${chains.length} chain(s): ${chains.map(c => c.name).join(', ')}`
    );

    this.validateEnvVars(chains);

    // ✅ Await all in parallel — worst case 10s total (not 10s × N)
    // Each chain times out independently — one failure doesn't block others
    await Promise.allSettled(
      chains.map(chain => this.connect(chain))
    );

    const connected = [...this.providers.keys()];
    const failed    = chains.filter(c => !this.providers.has(c.chainId)).map(c => c.name);

    if (connected.length) {
      this.logger.log(`✅ Connected: [${connected.map(id => this.chainName(id)).join(', ')}]`);
    }
    if (failed.length) {
      this.logger.warn(`⚠️  Not connected: [${failed.join(', ')}] — check env vars`);
    }
  }

  // ── Validate env vars before connecting ──────────────────────
  private validateEnvVars(chains: ChainConfig[]) {
    const seen = new Map<string, string>();
    for (const chain of chains) {
      const url = process.env[chain.wsEnvKey];
      if (!url) {
        this.logger.warn(`  ❌ ${chain.name}: ${chain.wsEnvKey} not set — skipping`);
        continue;
      }
      if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
        this.logger.error(`  ❌ ${chain.name}: URL must start with wss:// — got "${url.slice(0, 30)}"`);
        continue;
      }
      const host = this.extractHostname(url);
      if (seen.has(host)) {
        this.logger.warn(`  ⚠️  ${chain.name}: same host as ${seen.get(host)} — possible copy-paste error`);
      } else {
        seen.set(host, chain.name);
      }
      this.logger.log(`  ✅ ${chain.name}: ${this.maskUrl(url)}`);
    }
  }

  // ── Connect one chain ─────────────────────────────────────────
  async connect(chain: ChainConfig) {
    const url = process.env[chain.wsEnvKey];
    if (!url || (!url.startsWith('wss://') && !url.startsWith('ws://'))) return;

    try {
      this.logger.log(`${chain.name}: connecting...`);

      const provider = await this.createProviderWithHandshakeCheck(url, chain.name);

      const ws = (provider as any).websocket;
      if (ws) {
        ws.on('close', (code: number) => {
          this.logger.warn(`${chain.name} WS closed (code=${code}) — reconnecting`);
          this.stopHeartbeat(chain.chainId);
          this.providers.delete(chain.chainId);
          this.scheduleReconnect(chain);
        });
        ws.on('error', (err: Error) => {
          this.logger.error(`${chain.name} WS error: ${err.message}`);
        });
      }

      this.startHeartbeat(chain, provider);
      this.retryCount.set(chain.chainId, 0);
      this.providers.set(chain.chainId, provider);

      const block = await provider.getBlockNumber();
      this.logger.log(`✅ ${chain.name} connected — block ${block}`);

    } catch (err: any) {
      const msg = err?.message ?? String(err);

      if (msg.includes('403') || msg.includes('Forbidden')) {
        this.logger.error(
          `❌ ${chain.name}: 403 Forbidden — API key invalid.\n` +
          `   Try: wss://${this.chainPublicNode(chain.chainId)}`
        );
        return; // permanent failure — no retry
      }
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        this.logger.error(`❌ ${chain.name}: 401 Unauthorized — wrong API key in ${chain.wsEnvKey}`);
        return;
      }

      // Transient error — schedule retry
      this.logger.error(`❌ ${chain.name}: ${msg}`);
      this.scheduleReconnect(chain);
    }
  }

  // ── WS handshake with timeout ─────────────────────────────────
  private createProviderWithHandshakeCheck(
    url:       string,
    chainName: string,
  ): Promise<ethers.WebSocketProvider> {
    return new Promise((resolve, reject) => {
      const provider = new ethers.WebSocketProvider(url);
      const ws       = (provider as any).websocket;

      const timer = setTimeout(() => {
        reject(new Error(`${chainName}: handshake timeout after ${HANDSHAKE_TIMEOUT / 1000}s`));
      }, HANDSHAKE_TIMEOUT);

      if (!ws) {
        clearTimeout(timer);
        resolve(provider);
        return;
      }

      const onOpen = () => {
        clearTimeout(timer);
        ws.off('error', onError);
        resolve(provider);
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        ws.off('open', onOpen);
        reject(err);
      };

      ws.once('open',  onOpen);
      ws.once('error', onError);
    });
  }

  // ── Reconnect with exponential backoff ────────────────────────
  private scheduleReconnect(chain: ChainConfig) {
    if (this.reconnectTimers.has(chain.chainId)) return;

    const retries = this.retryCount.get(chain.chainId) ?? 0;
    if (retries >= MAX_RETRIES) {
      this.logger.error(`❌ ${chain.name}: max retries reached — restart to reconnect`);
      return;
    }

    const delay = Math.min(5_000 * Math.pow(2, retries), 60_000);
    this.logger.log(`${chain.name}: retry ${retries + 1}/${MAX_RETRIES} in ${delay / 1000}s`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(chain.chainId);
      this.retryCount.set(chain.chainId, retries + 1);
      await this.connect(chain);
    }, delay);

    this.reconnectTimers.set(chain.chainId, timer);
  }

  // ── Heartbeat ─────────────────────────────────────────────────
  private startHeartbeat(chain: ChainConfig, provider: ethers.WebSocketProvider) {
    this.stopHeartbeat(chain.chainId);
    const interval = setInterval(async () => {
      try {
        await provider.getBlockNumber();
      } catch {
        this.logger.warn(`${chain.name}: heartbeat failed — reconnecting`);
        this.stopHeartbeat(chain.chainId);
        this.providers.delete(chain.chainId);
        try { provider.destroy(); } catch (_) {}
        this.retryCount.set(chain.chainId, 0);
        this.scheduleReconnect(chain);
      }
    }, 30_000);
    this.heartbeats.set(chain.chainId, interval);
  }

  private stopHeartbeat(chainId: Chain) {
    const h = this.heartbeats.get(chainId);
    if (h) { clearInterval(h); this.heartbeats.delete(chainId); }
  }

  // ── Public API ────────────────────────────────────────────────
  get(chainId: Chain): ethers.WebSocketProvider | null {
    return this.providers.get(chainId) ?? null;
  }

  getAll(): Map<Chain, ethers.WebSocketProvider> {
    return this.providers;
  }

  isConnected(chainId: Chain): boolean {
    return this.providers.has(chainId);
  }

  getConnectedChains(): Chain[] {
    return [...this.providers.keys()];
  }

  async onModuleDestroy() {
    for (const i of this.heartbeats.values())      clearInterval(i);
    for (const t of this.reconnectTimers.values())  clearTimeout(t);
    for (const p of this.providers.values()) {
      try { p.destroy(); } catch (_) {}
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private maskUrl(url: string): string {
    return url.replace(/\/([a-f0-9]{8})[a-f0-9]{8,}/gi, '/$1***');
  }
  private extractHostname(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }
  private chainPublicNode(chainId: Chain): string {
    const m: Partial<Record<Chain, string>> = {
  
      [Chain.ETHEREUM]: 'eth-mainnet.g.alchemy.com/v2/TqeuB41KCR56GXskMrTPv',
      [Chain.BSC]:      'bsc.publicnode.com',
      [Chain.ARBITRUM]: 'arb-mainnet.g.alchemy.com/v2/TqeuB41KCR56GXskMrTPv',
      [Chain.POLYGON]:  'polygon-mainnet.g.alchemy.com/TqeuB41KCR56GXskMrTPv',
      [Chain.BASE]:     'base-mainnet.g.alchemy.com/TqeuB41KCR56GXskMrTPv',
      [Chain.OPTIMISM]: 'opt-mainnet.g.alchemy.com/TqeuB41KCR56GXskMrTPv',
    };
    return m[chainId] ?? 'publicnode.com';
  }
  private chainName(chainId: Chain): string {
    const m: Partial<Record<Chain, string>> = {
      [Chain.ETHEREUM]: 'Ethereum', [Chain.BSC]: 'BSC',
      [Chain.ARBITRUM]: 'Arbitrum', [Chain.POLYGON]: 'Polygon',
      [Chain.BASE]: 'Base',         [Chain.OPTIMISM]: 'Optimism',
    };
    return m[chainId] ?? String(chainId);
  }
}





// // ============================================================
// // chain-provider.factory.ts
// // Creates and manages one WebSocket provider per enabled chain.
// // Auto-reconnects on disconnect (ethers WebSocketProvider drops silently).
// // ============================================================
// import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// import { ethers } from 'ethers';
// import { Chain, ChainConfig, getEnabledChains } from '../common/chain.config';

// @Injectable()
// export class ChainProviderFactory{
//   private readonly logger    = new Logger(ChainProviderFactory.name);
//   private providers          = new Map<Chain, ethers.WebSocketProvider>();
//   private reconnectTimers    = new Map<Chain, NodeJS.Timeout>();

  
//   async init() {
//     for (const chain of getEnabledChains()) {
//       await this.connect(chain);
//     }
//   }

//   private async connect(chain: ChainConfig) {
//     const url = process.env[chain.wsEnvKey];
//     if (!url) return;

//     try {
//       const provider = new ethers.WebSocketProvider(url);
// console.log("provider in factory",provider,chain)
//       // Detect silent drops — WebSocket can die without firing 'close'
//       const ws = (provider as any).websocket;
//       if (ws) {
//         ws.on('close', () => {
//           this.logger.warn(`${chain.name} WS dropped — reconnecting`);
//           this.providers.delete(chain.chainId);
//           this.scheduleReconnect(chain);
//         });
//         ws.on('error', (err: any) => {
//           // ECONNREFUSED
//           // 403
//           // ETIMEDOUT
//           // DNS errors
//           // etc
      
//           this.logger.error(
//             `❌ ${chain.name} WS error: ${err.message}`,
//           );
      
//           // extra debug
//           console.error({
//             chain: chain.name,
      
//             error: err,
//           });
//         });
//       }

//       this.providers.set(chain.chainId, provider);
//       this.logger.log(`✅ ${chain.name} provider connected`);
//     } catch (err) {
//       this.logger.error(`${chain.name} provider failed`, err);
//       this.scheduleReconnect(chain);
//     }
//   }

//   private scheduleReconnect(chain: ChainConfig) {
//     if (this.reconnectTimers.has(chain.chainId)) return;
//     const timer = setTimeout(async () => {
//       this.reconnectTimers.delete(chain.chainId);
//       await this.connect(chain);
//     }, 5_000);
//     this.reconnectTimers.set(chain.chainId, timer);
//   }

//   get(chainId: Chain): ethers.WebSocketProvider | null {
    
//     return this.providers.get(chainId) ?? null;
//   }

//   getAll(): Map<Chain, ethers.WebSocketProvider> {
//     return this.providers;
//   }
// }
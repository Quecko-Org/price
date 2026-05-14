// ============================================================
// chain-provider.factory.ts
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { Chain, ChainConfig, getEnabledChains } from '../common/chain.config';

const MAX_RETRIES = 5;

@Injectable()
export class ChainProviderFactory  {
  private readonly logger = new Logger(ChainProviderFactory.name);

  private providers       = new Map<Chain, ethers.WebSocketProvider>();
  private reconnectTimers = new Map<Chain, NodeJS.Timeout>();
  private retryCount      = new Map<Chain, number>();
  private heartbeats      = new Map<Chain, NodeJS.Timeout>();

  async init() {
    const chains = getEnabledChains();
    this.logger.log(
      `🔌 Connecting to ${chains.length} chain(s): ${chains.map(c => c.name).join(', ')}`
    );

    // ✅ Validate all env vars FIRST before any connection attempt
    // Shows all problems at once instead of discovering them one by one
    this.validateEnvVars(chains);

    // Connect all chains in parallel — one failure doesn't block others
    await Promise.allSettled(
      chains.map(chain => this.connect(chain))
    );

    // Summary after all connection attempts
    const connected = [...this.providers.keys()];
    const failed    = chains
      .filter(c => !this.providers.has(c.chainId))
      .map(c => c.name);

    this.logger.log(
      `✅ Connected: [${connected.map(id => this.chainName(id)).join(', ')}]`
    );
    if (failed.length) {
      this.logger.warn(
        `⚠️  Failed/skipped: [${failed.join(', ')}] — check env vars above`
      );
    }
  }

  // ── Pre-flight env var validation ─────────────────────────────
  // Runs before any connection attempt so you see ALL problems at once.
  private validateEnvVars(chains: ChainConfig[]) {
    this.logger.log('📋 RPC URL validation:');

    const seen = new Map<string, string>(); // url → chainName

    for (const chain of chains) {
      const url = process.env[chain.wsEnvKey];

      if (!url) {
        this.logger.warn(`  ❌ ${chain.name}: ${chain.wsEnvKey} is not set`);
        continue;
      }

      if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
        this.logger.error(
          `  ❌ ${chain.name}: ${chain.wsEnvKey} must start with wss:// or ws://, got "${url.slice(0, 30)}..."`
        );
        continue;
      }

      // ✅ Detect duplicate URLs (like your POLYGON_WS = bsc.publicnode.com)
      const hostname = this.extractHostname(url);
      if (seen.has(hostname)) {
        this.logger.warn(
          `  ⚠️  ${chain.name}: ${chain.wsEnvKey} points to "${hostname}" ` +
          `which is also used by ${seen.get(hostname)} — possible copy-paste error`
        );
      } else {
        seen.set(hostname, chain.name);
      }

      this.logger.log(
        `  ✅ ${chain.name}: ${chain.wsEnvKey} = ${this.maskUrl(url)}`
      );
    }
  }

  // ── Connect one chain ─────────────────────────────────────────
  private async connect(chain: ChainConfig) {
    const url = process.env[chain.wsEnvKey];

    if (!url || (!url.startsWith('wss://') && !url.startsWith('ws://'))) {
      return; // already logged in validateEnvVars
    }

    try {
      this.logger.log(`${chain.name}: connecting...`);

      // ✅ 403 is thrown during WS handshake BEFORE getBlockNumber()
      // We catch it here by wrapping in a Promise that rejects on
      // the WS 'upgrade' error event which fires for 403/401
      const provider = await this.createProviderWithHandshakeCheck(url, chain.name);

      // Attach lifecycle handlers
      const ws = (provider as any).websocket;
      if (ws) {
        ws.on('close', (code: number, reason: Buffer) => {
          const reasonStr = reason?.toString() || 'no reason';
          this.logger.warn(
            `${chain.name} WS closed — code=${code} reason="${reasonStr}" — will reconnect`
          );
          this.stopHeartbeat(chain.chainId);
          this.providers.delete(chain.chainId);
          this.scheduleReconnect(chain);
        });

        // 'error' fires before 'close' for WS errors
        // We log here but let 'close' handle the reconnect
        ws.on('error', (err: Error) => {
          this.logger.error(
            `${chain.name} WS error: ${err.message} — ${this.getErrorAdvice(err.message)}`
          );
        });
      }

      this.startHeartbeat(chain, provider);
      this.retryCount.set(chain.chainId, 0);
      this.providers.set(chain.chainId, provider);

      const block = await provider.getBlockNumber();
      this.logger.log(`✅ ${chain.name} connected — latest block: ${block}`);

    } catch (err: any) {
      const message: string = err?.message ?? String(err);
      const code            = err?.code ?? '';

      // ── Permanent errors (don't retry) ────────────────────────
      if (message.includes('403') || message.includes('Forbidden')) {
        this.logger.error(
          `❌ ${chain.name}: 403 Forbidden\n` +
          `   URL: ${this.maskUrl(process.env[chain.wsEnvKey]!)}\n` +
          `   Fix: Your API key is invalid or expired for this chain.\n` +
          `   Tip: For free access use wss://${this.chainPublicNode(chain.chainId)}`
        );
        return; // no retry
      }

      if (message.includes('401') || message.includes('Unauthorized')) {
        this.logger.error(
          `❌ ${chain.name}: 401 Unauthorized — wrong API key in ${chain.wsEnvKey}`
        );
        return; // no retry
      }

      // ── Transient errors (retry with backoff) ─────────────────
      this.logger.error(
        `❌ ${chain.name}: connection failed — ${message}\n` +
        `   ${this.getErrorAdvice(message)}`
      );
      this.scheduleReconnect(chain);
    }
  }

  // ── Create provider and catch handshake errors (403 etc.) ─────
  // ethers.WebSocketProvider fires 403 as a WS 'upgrade' error
  // which is an 'error' event on the underlying ws object.
  // We wrap in a Promise so we can catch it synchronously.
  private createProviderWithHandshakeCheck(
    url:       string,
    chainName: string,
  ): Promise<ethers.WebSocketProvider> {
    return new Promise((resolve, reject) => {
      const provider = new ethers.WebSocketProvider(url);
      const ws       = (provider as any).websocket;

      // Set a handshake timeout
      const timeout = setTimeout(() => {
        reject(new Error(`Handshake timeout after 15s — check if the RPC URL is reachable`));
      }, 15_000);

      const cleanup = () => clearTimeout(timeout);

      if (!ws) {
        // No underlying WS object — resolve optimistically
        cleanup();
        resolve(provider);
        return;
      }

      // Fired when WS handshake succeeds (connection open)
      ws.once('open', () => {
        cleanup();
        // Remove the error listener we added below
        ws.off('error', onHandshakeError);
        resolve(provider);
      });

      // Fired if handshake fails (403, DNS, ECONNREFUSED etc.)
      const onHandshakeError = (err: Error) => {
        cleanup();
        ws.off('open', () => {});
        reject(err);
      };

      ws.once('error', onHandshakeError);
    });
  }

  // ── Exponential backoff reconnect ─────────────────────────────
  private scheduleReconnect(chain: ChainConfig) {
    if (this.reconnectTimers.has(chain.chainId)) return;

    const retries = this.retryCount.get(chain.chainId) ?? 0;

    if (retries >= MAX_RETRIES) {
      this.logger.error(
        `❌ ${chain.name}: ${MAX_RETRIES} consecutive failures — stopped retrying.\n` +
        `   Fix ${chain.wsEnvKey} and restart the app.`
      );
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

  // ── Heartbeat: detect silent WS drops ────────────────────────
  private startHeartbeat(chain: ChainConfig, provider: ethers.WebSocketProvider) {
    this.stopHeartbeat(chain.chainId);

    const interval = setInterval(async () => {
      try {
        await provider.getBlockNumber();
      } catch (err: any) {
        this.logger.warn(
          `${chain.name}: heartbeat failed (${err?.message}) — reconnecting`
        );
        this.stopHeartbeat(chain.chainId);
        this.providers.delete(chain.chainId);
        try { provider.destroy(); } catch (_) {}
        // Heartbeat failures reset retry count — transient network issue
        this.retryCount.set(chain.chainId, 0);
        this.scheduleReconnect(chain);
      }
    }, 30_000);

    this.heartbeats.set(chain.chainId, interval);
  }

  private stopHeartbeat(chainId: Chain) {
    const interval = this.heartbeats.get(chainId);
    if (interval) {
      clearInterval(interval);
      this.heartbeats.delete(chainId);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private maskUrl(url: string): string {
    // Hide API key: keep first 8 chars of any hex-like segment
    return url.replace(/\/([a-f0-9]{8})[a-f0-9]{8,}/gi, '/$1***');
  }

  private extractHostname(url: string): string {
    try { return new URL(url).hostname; }
    catch { return url; }
  }

  private chainPublicNode(chainId: Chain): string {
    const map: Partial<Record<Chain, string>> = {
      [Chain.ETHEREUM]: 'ethereum.publicnode.com',
      [Chain.BSC]:      'bsc.publicnode.com',
      [Chain.ARBITRUM]: 'arbitrum.publicnode.com',
      [Chain.POLYGON]:  'polygon.publicnode.com',
      [Chain.BASE]:     'base.publicnode.com',
      [Chain.OPTIMISM]: 'optimism.publicnode.com',
    };
    return map[chainId] ?? 'publicnode.com';
  }

  private chainName(chainId: Chain): string {
    const names: Partial<Record<Chain, string>> = {
      [Chain.ETHEREUM]: 'Ethereum',
      [Chain.BSC]:      'BSC',
      [Chain.ARBITRUM]: 'Arbitrum',
      [Chain.POLYGON]:  'Polygon',
      [Chain.BASE]:     'Base',
      [Chain.OPTIMISM]: 'Optimism',
    };
    return names[chainId] ?? String(chainId);
  }

  private getErrorAdvice(message: string): string {
    if (message.includes('403') || message.includes('Forbidden'))
      return 'Your API key is invalid or expired.';
    if (message.includes('ECONNREFUSED'))
      return 'RPC node is refusing connections — try a different endpoint.';
    if (message.includes('ETIMEDOUT') || message.includes('timeout'))
      return 'Connection timed out — check your network or try a different RPC.';
    if (message.includes('ENOTFOUND') || message.includes('DNS'))
      return 'DNS resolution failed — check the hostname in your env var.';
    return 'Check your RPC endpoint and API key.';
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
    for (const interval of this.heartbeats.values())      clearInterval(interval);
    for (const timer    of this.reconnectTimers.values())  clearTimeout(timer);
    for (const provider of this.providers.values()) {
      try { provider.destroy(); } catch (_) {}
    }
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
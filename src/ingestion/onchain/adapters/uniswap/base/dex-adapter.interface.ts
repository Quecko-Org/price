export interface DexAdapter {
    initializePools(pools: any[], chain: string): Promise<void>;
    start(pool: any, marketId: number, base: string): void;
  }
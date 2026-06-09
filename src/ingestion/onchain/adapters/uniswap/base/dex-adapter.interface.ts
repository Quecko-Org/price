export interface DexAdapter {
    initializePools(pools: any[], chain: string): Promise<void>;
    start(pool: any, marketId: number, base: string): void;
  }

  export interface PoolMarketMapping {
    marketId:     number;
    marketBase:   string;   // canonical CEX symbol e.g. "ETH"
    baseIsToken0: boolean;  // which token is the market base
  }
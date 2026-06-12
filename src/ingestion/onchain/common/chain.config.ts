// ============================================================
// chain.config.ts
//
// FIX: All contract addresses stored as lowercase.
// ethers v6 getAddress() validates EIP-55 checksum strictly.
// Storing as lowercase avoids INVALID_ARGUMENT checksum errors
// when passed to new ethers.Contract(address, abi, provider).
// ethers will checksum them internally when needed.
// ============================================================

export enum Chain {
  ETHEREUM = 1,
  BSC      = 56,
  ARBITRUM = 42161,
  POLYGON  = 137,
  BASE     = 8453,
  OPTIMISM = 10,
}

export enum DexType {
  UNISWAP_V3     = 'UNISWAP_V3',
  UNISWAP_V4     = 'UNISWAP_V4',
  PANCAKESWAP_V3 = 'PANCAKESWAP_V3', // BSC equivalent of Uniswap V3
}

export interface ChainConfig { 
  chainId:              Chain;
  name:                 string;
  wsEnvKey:             string;   // process.env key for WS RPC URL
  multicall:            string;   // Multicall3 — same on every EVM chain
  subgraphV4Id:         string;   // The Graph subgraph ID for V4 (empty = no V4)
  stateView:            string;   // V4 StateView contract (empty = no V4)
  uniswapV3Factory:     string;   // V3 factory (PancakeSwap uses same interface)
  uniswapV4PoolManager: string;   // empty string = chain has no V4
  hasV4:                boolean;  // quick flag — avoids string checks
  quoteAddresses:       Set<string>; // always lowercase
}

export const CHAIN_CONFIGS: Record<Chain, ChainConfig> = {

  [Chain.ETHEREUM]: {
    chainId:              Chain.ETHEREUM,
    name:                 'Ethereum',
    wsEnvKey:             'ETH_WS',
    multicall:            '0xcA11bde05977b3631167028862bE2a173976CA11',
    subgraphV4Id:         'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G',
    stateView:            '0x7ffe42c4a5deea5b0fec41c94c136cf115597227',
    uniswapV3Factory:     '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    uniswapV4PoolManager: '0x000000000004444c5dc75cb358380d2e3de08a90',
    hasV4:                true,
    quoteAddresses: new Set([
      '0x0000000000000000000000000000000000000000',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xdac17f958d2ee523a2206206994597c13d831ec7',
      '0x6b175474e89094c44da98b954eedeac495271d0f',
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      '0x0000000000085d4780b73119b644ae5ecd22b376',
      '0x853d955acef822db058eb8505911ed77f175b99e',
    ]),
  },
  // ── BSC ────────────────────────────────────────────────────
  // PancakeSwap V3 uses the Uniswap V3 interface — same ABIs.
  // BSC has no Uniswap V4 deployment yet. 
   [Chain.BSC]: {
    chainId:              Chain.BSC,
    name:                 'BSC',
    wsEnvKey:             'BSC_WS',
    multicall:            '0xca11bde05977b3631167028862be2a173976ca11',
    subgraphV4Id:         '',  //No v4
    stateView:            '',
    uniswapV3Factory:     '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865',
    uniswapV4PoolManager: '',
    hasV4:                false,
    quoteAddresses: new Set([
      '0x0000000000000000000000000000000000000000', // native BNB
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
      '0x55d398326f99059ff775485246999027b3197955', // USDT (BSC)
      '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI (BSC)
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB (wrapped BTC on BSC)
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH (on BSC)
    ]),
  },

  [Chain.ARBITRUM]: {
    chainId:              Chain.ARBITRUM,
    name:                 'Arbitrum',
    wsEnvKey:             'ARBITRUM_WS',
    multicall:            '0xca11bde05977b3631167028862be2a173976ca11',
    subgraphV4Id:         'ARBITRUM_V4_SUBGRAPH_ID',
    stateView:            '0x76fd297c1f6b1e40aa88c0bb4dd3cdca7ce7d67',
    uniswapV3Factory:     '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    uniswapV4PoolManager: '0x360e68facca8ca495c1b759fd9eee466db9fb32',
    hasV4:                true,
    quoteAddresses: new Set([
        '0x0000000000000000000000000000000000000000',
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
      '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC.e
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC native
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', // WBTC
    ]),
  },

  [Chain.POLYGON]: {
    chainId:              Chain.POLYGON,
    name:                 'Polygon',
    wsEnvKey:             'POLYGON_WS',
    multicall:            '0xca11bde05977b3631167028862be2a173976ca11',
    subgraphV4Id:         'POLYGON_V4_SUBGRAPH_ID',
    stateView:            '0x5add1d808ee2cb16a87f7a1fea5e895b50f22dc2',
    uniswapV3Factory:     '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    uniswapV4PoolManager: '0x67366782805870060151383f4bbff9dab53e5cd6',
    hasV4:                true,
    quoteAddresses: new Set([
      '0x0000000000000000000000000000000000000000',
     '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC.e
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // USDC native
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', // WBTC
    ]),
  },

  [Chain.BASE]: {
    chainId:              Chain.BASE,
    name:                 'Base',
    wsEnvKey:             'BASE_WS',
    multicall:            '0xca11bde05977b3631167028862be2a173976ca11',
    subgraphV4Id:         'BASE_V4_SUBGRAPH_ID',
    stateView:            '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    uniswapV3Factory:     '0x33128a8fc17869897dce68ed026d694621f6fdfd',
    uniswapV4PoolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    hasV4:                true,
    quoteAddresses: new Set([
     '0x0000000000000000000000000000000000000000',
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
    ]),
  },

  [Chain.OPTIMISM]: {
    chainId:              Chain.OPTIMISM,
    name:                 'Optimism',
    wsEnvKey:             'OPTIMISM_WS',
    multicall:            '0xca11bde05977b3631167028862be2a173976ca11',
    subgraphV4Id:         'OPTIMISM_V4_SUBGRAPH_ID',
    // ✅ FIXED: was '0xcDd9585005095ac8f83213D2F58c16a8e8c5a7be' (wrong checksum)
    stateView:            '0xcdd9585005095ac8f83213d2f58c16a8e8c5a7be',
    uniswapV3Factory:     '0x1f98431c8ad98523631ae4a59f267346ea31f984',
    uniswapV4PoolManager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
    hasV4:                true,
    quoteAddresses: new Set([
      '0x0000000000000000000000000000000000000000',
         '0x4200000000000000000000000000000000000006', // WETH
      '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC native
      '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // USDC.e
      '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
    ]),
  },
};

/** Returns only chains whose WS RPC env var is set */
export function getEnabledChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter(c => !!process.env[c.wsEnvKey]);
}

/** Returns chains that have V4 and are enabled */
export function getV4EnabledChains(): ChainConfig[] {
  return getEnabledChains().filter(c => c.hasV4 && !!c.uniswapV4PoolManager);
}

/** Returns chains that have V3 (all of them) and are enabled */
export function getV3EnabledChains(): ChainConfig[] {
  return getEnabledChains().filter(c => !!c.uniswapV3Factory);
}
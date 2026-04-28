export const STABLES = ["USDT", "USDC", "DAI", "TUSD", "FDUSD", "BUSD"];

export const WRAPPED = ["WBTC", "WETH"];
export const BASE_TOKEN=["USDT", "USDC", "WETH"];
export const TOKEN_ALIAS: Record<string, string> = {
    WETH: "ETH",
    WBTC: "BTC",
  };
  
  export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
  export const QUOTE_SYMBOLS = new Set([
    "USDT", "USDC", "DAI", "TUSD", "FDUSD", "BUSD", // stables = direct USD
    "nativeETH",   // native ETH (V4 address(0)) — priced via CEX
    "WETH",  // WETH ERC-20 (V3 mainly)  — priced via CEX ETH price
    "WBTC",  // priced via CEX BTC price
    "BTC",
  ]);

  export const QUOTE_ADDRESSES = new Set([
    "0x0000000000000000000000000000000000000000", // native ETH (V4)
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
    "0x0000000000085d4780b73119b644ae5ecd22b376", // TUSD
    "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  ]); 
export const UNISWAP3_FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
    // "event PoolCreated(address indexed token0, address indexed token1, uint24 fee, int24 tickSpacing, address pool)"
  ];

  export const UNISWAP3_POOL_ABI = [
    "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"
  ];
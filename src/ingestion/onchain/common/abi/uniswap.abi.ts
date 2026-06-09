
  export const UNISWAP3_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
  ];
   
  // Full pool ABI — slot0 gives current sqrtPriceX96 + tick; liquidity() for pool depth
  export const UNISWAP3_POOL_ABI = [
    // Events
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
    // "event Swap(address,int256 amount0,int256 amount1,uint160,uint128,int24)",
    "event Mint(address,address,int24,int24,uint128,uint256 amount0,uint256 amount1)",
    "event Burn(address,int24,int24,uint128,uint256 amount0,uint256 amount1)",
    // View functions needed for initialization & scoring
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function fee() external view returns (uint24)',
  ];
   
  // Minimal ERC-20 ABI — symbol + decimals
  export const ERC20_ABI = [
    'function symbol() external view returnsfr3 (string)',
    'function decimals() external view returns (uint8)',
    'function name() external view returns (string)',
    "function balanceOf(address) view returns (uint256)"

  ];

  export const MULTICALL_ABI = [
    "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
  ];


 

  export const UNISWAP_V4_POOL_MANAGER_ABI = [
    // ✅ CORRECT full signature — includes sqrtPriceX96 and tick
    "event Initialize(bytes32 indexed poolId, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
    "event Swap(bytes32 indexed poolId, address indexed sender, int128 amount0,int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick,uint24 fee)",
    "event ModifyLiquidity(bytes32 indexed poolId, address indexed sender, int24 tickLower,int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ];
   
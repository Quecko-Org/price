import { Chain } from "./chain.enum";
import { Dex } from "./dex.enum";

export interface DexTrade {
  symbol: string;
  chain: Chain;
  dex: Dex;
  poolAddress: string;
  price: number;
  volume: number;
  timestamp: number;
}

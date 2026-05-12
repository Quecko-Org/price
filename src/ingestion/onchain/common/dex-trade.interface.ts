import { Chain } from "./chain.config";
import { Dex } from "./dex.enum";

export interface DexTrade {
  symbol: string;
  chain: Chain;
  dex: Dex;
  poolKey: string;
  price: number;
  volume: number;
  timestamp: number;
}

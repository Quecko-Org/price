import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
import { Token } from "../entities/token.entity";

const TOKEN_ADDRESS_MAP: Record<string, string> = {
  BTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
  ETH: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2", // WETH
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  USDC: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
};

const DECIMALS_MAP: Record<string, number> = {
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
};

@Injectable()
export class TokenSyncService {

  constructor(
    @InjectRepository(SymbolEntity)
    private symbolRepo: Repository<SymbolEntity>,

    @InjectRepository(Token)
    private tokenRepo: Repository<Token>,
  ) { }

  async sync() {

    try {
      console.log("sssssssync")
      const symbols = await this.symbolRepo.find();
      // console.log("symbols",symbols[0])
      const uniqueBases = new Set(symbols.map(s => s.base));
      // console.log("uniqueBases",uniqueBases)

      for (const base of uniqueBases) {

        const address = TOKEN_ADDRESS_MAP[base];
        // console.log("address",address)
        if (!address) continue; // skip unknown tokens

        const exists = await this.tokenRepo.findOne({
          where: {
            address
          }
        });
        // console.log("existss", exists)

        if (exists) continue;



        // console.log("exisssts", exists)

        await this.tokenRepo.save({
          chain: "ETH",
          address,
          symbol: base === "BTC" ? "WBTC" : base === "ETH" ? "WETH" : base,
          canonicalSymbol: base === "BTC" ? "WBTC" : base === "ETH" ? "WETH" : base,
          decimals: DECIMALS_MAP[base] || 18,
        });
      }
    } catch (err) {
      console.log("error in token sync", err)
    }
  }
}
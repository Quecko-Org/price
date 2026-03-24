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
  ) {}

  async sync() {

    const symbols = await this.symbolRepo.find();

    const uniqueBases = new Set(symbols.map(s => s.base));

    for (const base of uniqueBases) {

      const address = TOKEN_ADDRESS_MAP[base];
      if (!address) continue; // skip unknown tokens

      const exists = await this.tokenRepo.findOne({
        where: { address }
      });

      if (exists) continue;

      await this.tokenRepo.save({
        chain: "ETH",
        address,
        symbol: base === "BTC" ? "WBTC" : base === "ETH" ? "WETH" : base,
        decimals: DECIMALS_MAP[base] || 18,
      });
    }
  }
}
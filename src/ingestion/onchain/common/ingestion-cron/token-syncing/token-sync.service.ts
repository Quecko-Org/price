import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Token } from "../../entities/token.entity";
import { SymbolsService } from "@/ingestion/symbols/symbol.service";
import { STABLES, WRAPPED } from "../../common-tokens";

const WRAPPED_MAP: Record<string, string> = {
  BTC: "WBTC",
  ETH: "WETH",
  MATIC: "POL",

};


@Injectable()
export class TokenSyncService {

  constructor(
    @InjectRepository(Token)
    private tokenRepo: Repository<Token>,
    private readonly symbolsService: SymbolsService,
  ) { }

  private mapSymbol(symbol: string) {
    return WRAPPED_MAP[symbol] || symbol;
  }

  async sync() {
    try {
      console.log("🔄 Syncing tokens...");

      // 1️⃣ Get markets
      const markets = await this.symbolsService.markets();

      const neededTokens = new Set<string>();

      for (const m of markets) {
        neededTokens.add(m.base);
        neededTokens.add(m.quote);
      }
      // ✅ ALWAYS include stables
      STABLES.forEach(s => neededTokens.add(s));
      console.log("lengthhhhh", neededTokens.size)

      // 2️⃣ Fetch Uniswap token list
      const res = await fetch("https://tokens.uniswap.org");
       if (!res.ok) {
        const text = await res.text();
        console.error('Error response:', text);
        // throw new Error(`HTTP ${res.status}`);
      }
            const data = await res.json();
      
 
      const tokenList = data.tokens.filter((t: any) => t.chainId === 1);

      // Map: symbol → array of tokens
      const tokenMap = new Map<string, any[]>();

      for (const t of tokenList) {
        if (!tokenMap.has(t.symbol)) {
          tokenMap.set(t.symbol, []);
        }
        tokenMap.get(t.symbol)!.push(t);
      }
      // console.log("tokenMap size:", tokenMap);

      // ✅ preload existing tokens (avoid N queries)
      const existing = await this.tokenRepo.find();
      const existingMap = new Map(existing.map(t => [t.address, t]));

      // 3️⃣ Process tokens
      for (const symbol of neededTokens) {
        if (WRAPPED.includes(symbol)) continue;
        const mapped = this.mapSymbol(symbol);
        const candidates = tokenMap.get(mapped);
        if (!candidates || candidates.length === 0) {
          continue;
        }

        // ✅ pick best candidate (simple strategy)
        const tokenMeta = candidates[0];

        if (existingMap.has(tokenMeta.address)) {
          continue;
        }
        const exists = await this.tokenRepo.exists({
          where: { address: tokenMeta.address },
        });

        if (exists) continue;

        await this.tokenRepo.save({
          chain: "ETH",
          chainId: 1,
          address: tokenMeta.address,
          canonicalSymbol: symbol,        // ETH
          symbol: tokenMeta.symbol,       // WETH
          decimals: tokenMeta.decimals,
        });

        console.log(`✅ Saved: ${symbol} → ${tokenMeta.symbol}`);
      }

    } catch (err) {
      console.error("❌ Error in token sync:", err);
    }
  }
}


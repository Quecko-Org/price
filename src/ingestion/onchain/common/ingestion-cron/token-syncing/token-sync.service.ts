import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import axios from "axios";
import { Token } from "../../entities/token.entity";
import { SymbolsService } from "@/ingestion/symbols/symbol.service";
import { RedisService } from "@/common-module/redis/redis.service";
import { STABLES, WRAPPED } from "../../common-tokens";
import { Chain, CHAIN_CONFIGS, getEnabledChains } from "../../chain.config";
import * as crypto from "crypto";

const WRAPPED_MAP: Record<string, string> = {
  BTC: "WBTC", ETH: "WETH", MATIC: "POL", BNB: "WBNB",
};

const NATIVE_TOKENS: Record<Chain, { symbol: string; canonicalSymbol: string; decimals: number }> = {
  [Chain.ETHEREUM]: { symbol: "ETH",   canonicalSymbol: "ETH",   decimals: 18 },
  [Chain.BSC]:      { symbol: "BNB",   canonicalSymbol: "BNB",   decimals: 18 },
  [Chain.ARBITRUM]: { symbol: "ETH",   canonicalSymbol: "ETH",   decimals: 18 },
  [Chain.POLYGON]:  { symbol: "MATIC", canonicalSymbol: "MATIC", decimals: 18 },
  [Chain.BASE]:     { symbol: "ETH",   canonicalSymbol: "ETH",   decimals: 18 },
  [Chain.OPTIMISM]: { symbol: "ETH",   canonicalSymbol: "ETH",   decimals: 18 },
};

const TOKEN_LIST_SOURCES: Partial<Record<Chain, { url: string; chainId: number }>> = {
  [Chain.ETHEREUM]: { url: "https://tokens.uniswap.org",                                   chainId: 1     },
  [Chain.BSC]:      { url: "https://tokens.pancakeswap.finance/pancakeswap-extended.json", chainId: 56    },
  [Chain.ARBITRUM]: { url: "https://tokens.uniswap.org",                                   chainId: 42161 },
  [Chain.POLYGON]:  { url: "https://tokens.uniswap.org",                                   chainId: 137   },
  [Chain.BASE]:     { url: "https://tokens.uniswap.org",                                   chainId: 8453  },
  [Chain.OPTIMISM]: { url: "https://tokens.uniswap.org",                                   chainId: 10    },
};

const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
const SKIP_SYMBOLS = new Set(["USD", "USDC.e", "USDT.e"]);

@Injectable()
export class TokenSyncService {
  private readonly logger = new Logger(TokenSyncService.name);

  constructor(
    @InjectRepository(Token)
    private tokenRepo: Repository<Token>,
    private readonly symbolsService: SymbolsService,
    private readonly redis: RedisService,
  ) {}

  private mapSymbol(symbol: string): string {
    return WRAPPED_MAP[symbol] ?? symbol;
  }

  async sync() {
    const enabled = getEnabledChains();
    this.logger.log(`🔄 Token sync for ${enabled.length} chains: ${enabled.map(c => c.name).join(", ")}`);

    const markets = await this.symbolsService.markets();

    const neededSymbols = new Set<string>();
    for (const m of markets) {
      neededSymbols.add(m.base);
    } 
    STABLES.forEach(s => neededSymbols.add(s));
    for (const s of SKIP_SYMBOLS) neededSymbols.delete(s);

    this.logger.log(`📋 ${neededSymbols.size} symbols needed`);

    for (const chain of enabled) {
      await this.syncChain(chain.chainId, neededSymbols);
    }

    this.logger.log("✅ Token sync complete");
  }

  async syncChain(chainId: Chain, neededSymbols: Set<string>) {
    const config = CHAIN_CONFIGS[chainId];
    this.logger.log(`🔄 ${config.name} token sync...`);

    try {
      await this.seedNativeToken(chainId);

      const source = TOKEN_LIST_SOURCES[chainId];
      if (!source) {
        this.logger.warn(`${config.name}: no token list source configured`);
        return;
      }

      const tokenList = await this.fetchTokenList(source.url, source.chainId);
      console.log("tokenlisttt",tokenList.length,chainId)
      if (!tokenList.length) {
        this.logger.warn(`${config.name}: empty token list`);
        return;
      }

      const hash     = this.hashList(tokenList);
      const lastHash = await this.redis.get(`token-sync:hash:${chainId}`).catch(() => null);
      console.log("tokenlisttt",tokenList.length,chainId,hash,lastHash)

      if (lastHash === hash) {
        this.logger.log(`${config.name}: token list unchanged — skipping`);
        return;
      }

      this.logger.log(`${config.name}: ${tokenList.length} tokens in list`);
 
      const tokenMap = new Map<string, any[]>();
      for (const t of tokenList) {
        if (!t.symbol) continue;
        if (!tokenMap.has(t.symbol)) tokenMap.set(t.symbol, []);
        tokenMap.get(t.symbol)!.push(t);
      }

      const existing          = await this.tokenRepo.find({ where: { chainId } });
      const existingByAddress = new Map(existing.map(t => [t.address.toLowerCase(), t]));

      const toSave: Partial<Token>[] = [];

      for (const symbol of neededSymbols) {
        if (WRAPPED.includes(symbol)) continue;

        const mapped     = this.mapSymbol(symbol);
        const candidates = tokenMap.get(mapped);
        if (!candidates?.length) continue;

        const tokenMeta = candidates.reduce((best: any, t: any) =>
          Object.keys(t.extensions ?? {}).length >= Object.keys(best.extensions ?? {}).length ? t : best
        );

        if (existingByAddress.has(tokenMeta.address.toLowerCase())) continue;

        toSave.push({
          chain:           config.name,
          chainId,
          address:         tokenMeta.address.toLowerCase(),
          symbol:          tokenMeta.symbol,
          canonicalSymbol: symbol,
          decimals:        tokenMeta.decimals,
        });

        existingByAddress.set(tokenMeta.address.toLowerCase(), tokenMeta);
      }

      if (toSave.length) {
        await this.tokenRepo
          .createQueryBuilder()
          .insert()
          .into(Token)
          .values(toSave)
          .orIgnore()
          .execute();
        this.logger.log(`✅ ${config.name}: ${toSave.length} new tokens saved`);
      } else {
        this.logger.log(`✅ ${config.name}: no new tokens`);
      }

      await this.redis.setex(`token-sync:hash:${chainId}`, 86_400, hash).catch(() => null);

    } catch (err: any) {
      this.logger.error(`${config.name} token sync failed: ${err?.message}`);
    }
  }

  private async seedNativeToken(chainId: Chain) {
    const native = NATIVE_TOKENS[chainId];
    if (!native) return;

    const exists = await this.tokenRepo.exists({
      where: { address: NATIVE_ETH_ADDRESS, chainId },
    });
    if (exists) return;

    await this.tokenRepo.save({
      chain:           CHAIN_CONFIGS[chainId].name,
      chainId,
      address:         NATIVE_ETH_ADDRESS,
      symbol:          native.symbol,
      canonicalSymbol: native.canonicalSymbol,
      decimals:        native.decimals,
    });

    this.logger.log(`✅ ${CHAIN_CONFIGS[chainId].name}: seeded native ${native.symbol}`);
  }

  // FIX: replaced fetch() with axios — fetch() follows redirects and hits 414.
  // axios handles redirects correctly and is already used everywhere else.
  private async fetchTokenList(url: string, chainId: number): Promise<any[]> {
    try {
      const res  = await axios.get(url, {
        timeout: 15_000,
        headers: { 'Accept': 'application/json' },
        maxRedirects: 5,
      });
      const data = res.data;
      const raw  = Array.isArray(data) ? data : (data.tokens ?? []);
      return raw.filter((t: any) => t.chainId === chainId);
    
    } catch (err: any) {
      this.logger.error(`Token list fetch failed (${url}): ${err?.message}`);
      return [];
    }
  }

  private hashList(tokens: any[]): string {
    const sorted = tokens.map(t => t.address?.toLowerCase() ?? "").sort().join(",");
    return crypto.createHash("md5").update(sorted).digest("hex");
  }
}
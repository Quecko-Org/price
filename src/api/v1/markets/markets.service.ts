// ============================================================
// markets.service.ts
// Flow: Controller → Service → Repository
// Service owns all business logic. Repository owns all SQL.
// ============================================================
import { Injectable } from '@nestjs/common';
import { MarketsRepository } from './markets.repository';
import { TokenMetadataService } from '../token-metadata/token-metadata.service';

@Injectable()
export class MarketsService {

  constructor(
    private readonly repo: MarketsRepository,
      private readonly tokenMetaSvc: TokenMetadataService,

  ) {}

  // ── EXISTING ─────────────────────────────────────────────────

  async getMarkets(
    marketId: number,
    interval: string,
    from?: number,
    to?: number,
    limit?: number,
  ) {
    const rows = await this.repo.getMarkets(marketId, interval, from, to, limit);
    return rows.map(r => ({
      t: Math.floor(new Date(r.openTime).getTime() / 1000),
      o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume,
    }));
  }

  async getLatestPrice(marketId: number) {
    const rows = await this.repo.getLatestPrice(marketId);
    return { time: rows[0]?.openTime, price: rows[0]?.close ?? null };
  }

  async get24hStats(marketId: number) {
    const rows = await this.repo.get24hStats(marketId);
    const r    = rows[0];
    return {
      high:       +r.high,
      low:        +r.low,
      volumeBase: r.baseVolume,
      volumeUsdt: r.volumeUSDT,
    };
  }

  // ── NEW ───────────────────────────────────────────────────────

  async getMarketList(opts: {
    page:    number;
    limit:   number;
    sort:    string;
    order:   string;
    search?: string;
  }) {
    return this.repo.getMarketList(opts);
  }

  async getTokenOverview(marketId: number, symbol: string) {
    const [stats, extended, dexSummary, metadata, exchangeStats] = await Promise.all([
      this.repo.get24hStats(marketId),
      this.repo.getExtendedStats(marketId),
      this.repo.getDexSummary(symbol),
      this.tokenMetaSvc.getByMarketId(marketId),       // static metadata
      this.repo.getExchangeStats(symbol),               // live per-exchange
    ]);
 
    const s = stats[0] ?? {};
 
    return {
      // ── Live price data (from aggregated candles) ────────────
      price:         +s.close   || 0,
      open24h:       +s.open    || 0,
      high24h:       +s.high    || 0,
      low24h:        +s.low     || 0,
      change24h:     s.open > 0 ? +(((s.close - s.open) / s.open) * 100).toFixed(2) : 0,
      volume24hBase: +s.baseVolume || 0,
      volume24hUsd:  +s.volumeUSDT || 0,
 
      // ── Extended time ranges ──────────────────────────────────
      high7d:    +extended.high7d   || 0,
      low7d:     +extended.low7d    || 0,
      high30d:   +extended.high30d  || 0,
      low30d:    +extended.low30d   || 0,
      volume7d:  +extended.volume7d  || 0,
      volume30d: +extended.volume30d || 0,
 
      // ── DEX summary (from dex_pools) ─────────────────────────
      dex: {
        poolCount:      dexSummary.poolCount,
        totalLiquidity: dexSummary.totalLiquidity,
        volume24h:      dexSummary.volume24h,
      },
 
      // ── Per-exchange live data (from symbol_exchanges) ────────
      // price per exchange, volume, bid/ask, spread, depth
      exchanges: exchangeStats,
 
      // ── Static metadata (from token_metadata) ─────────────────
      // null if not yet seeded — call POST /metadata/seed to populate
      metadata: metadata ? {
        name:        metadata.name,
        symbol:      metadata.symbol,
        description: metadata.description,
        tags:        metadata.tags,
        logoUrl:     metadata.logoUrl,
 
        supply: {
          circulating: metadata.circulatingSupply,
          total:       metadata.totalSupply,
          max:         metadata.maxSupply,
        },
 
        valuation: {
          marketCap: metadata.marketCap,
          fdv:       metadata.fdv,
        },
 
        holders: metadata.holders,
 
        allTimeHigh: { price: metadata.ath,  date: metadata.athDate },
        allTimeLow:  { price: metadata.atl,  date: metadata.atlDate },
 
        contracts:  metadata.contracts,
        websites:   metadata.websites,
        explorers:  metadata.explorers,
        whitepaper: metadata.whitepaper,
        socials:    metadata.socials,
        updatedAt:  metadata.updatedAt,
      } : null,
    };
  }
  async getExchangeStats(symbol: string) {
    return this.repo.getExchangeStats(symbol);
  }

  async getDexPools(opts: {
    symbol:       string;
    dex?:         string;
    chain?:       number;
    minLiquidity?: number;
    page?:         number;
    limit?:        number;
    sort?:         string;
  }) {
    return this.repo.getDexPools(opts);
  }

  async getAllPairs(opts: {
    symbol: string;
    type:   'all' | 'cex' | 'dex';
    page?:   number;
    limit?:  number;
  }) {
    return this.repo.getAllPairs(opts);
  }

  async getPoolDetail(poolId: number) {
    return this.repo.getPoolDetail(poolId);
  }

  async getTopPools(opts: {
    dex?:         string;
    chain?:       number;
    minLiquidity?: number;
    page?:         number;
    limit?:        number;
    sort?:         string;
  }) {
    return this.repo.getTopPools(opts);
  }





    async getTokenMetadata(marketId: number, symbol: string) {
    const meta = await this.tokenMetaSvc.getByMarketId(marketId);
    if (!meta) {
      return {
        available: false,
        message:   `No metadata yet for ${symbol}. POST /api/v1/markets/${symbol}/metadata/seed to fetch from CoinGecko.`,
      };
    }
    return {
      available:   true,
      name:        meta.name,
      symbol:      meta.symbol,
      description: meta.description,
      tags:        meta.tags,
      logoUrl:     meta.logoUrl,
      supply: {
        circulating: meta.circulatingSupply,
        total:       meta.totalSupply,
        max:         meta.maxSupply,
      },
      valuation: {
        marketCap: meta.marketCap,
        fdv:       meta.fdv,
      },
      holders:    meta.holders,
      allTimeHigh: { price: meta.ath,  date: meta.athDate },
      allTimeLow:  { price: meta.atl,  date: meta.atlDate },
      contracts:   meta.contracts,
      websites:    meta.websites,
      explorers:   meta.explorers,
      whitepaper:  meta.whitepaper,
      socials:     meta.socials,
      updatedAt:   meta.updatedAt,
      source:      meta.dataSource,
    };
  }
 
  async seedTokenMetadata(symbol: string): Promise<boolean> {
    return this.tokenMetaSvc.seedToken(symbol);
  }
 
  async upsertTokenMetadata(marketId: number, data: Record<string, any>) {
    return this.tokenMetaSvc.upsert(marketId, data);
  }

}
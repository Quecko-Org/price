// ============================================================
// token-metadata.service.ts
//
// Seeds and updates token_metadata from CoinGecko free API.
// CoinGecko free tier: 30 calls/min, no API key needed.
//
// Sync strategy:
//   - On demand: seedToken(symbol) for a single token
//   - Cron: syncTopTokens() runs weekly for top 200 by market cap
//   - Manual: upsert() for admin-entered data
// ============================================================
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { TokenMetadataEntity } from './token-metadata.entity';
import { MarketEntity } from '@/market-data/market.entity';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const RATE_LIMIT_MS  = 2_500; // 24 req/min safe (free tier = 30/min)

@Injectable()
export class TokenMetadataService {
  private readonly logger = new Logger(TokenMetadataService.name);

  constructor(
    @InjectRepository(TokenMetadataEntity)
    private readonly metaRepo: Repository<TokenMetadataEntity>,

    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {}

  // ── Get metadata for one token ────────────────────────────────
  async getBySymbol(symbol: string): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({
      where: { market: { base: symbol } },
      relations: ['market'],
    });
  }

  async getByMarketId(marketId: number): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({ where: { marketId } });
  }

  // ── Manual upsert (admin endpoint) ───────────────────────────
  async upsert(marketId: number, data: Partial<TokenMetadataEntity>) {
    const existing = await this.metaRepo.findOne({ where: { marketId } });
    if (existing) {
      Object.assign(existing, data);
      return this.metaRepo.save(existing);
    }
    return this.metaRepo.save(this.metaRepo.create({ marketId, ...data }));
  }

  // ── Seed one token from CoinGecko ─────────────────────────────
  async seedToken(symbol: string): Promise<boolean> {
    const market = await this.marketRepo.findOne({ where: { base: symbol } });
    if (!market) {
      this.logger.warn(`No market found for ${symbol}`);
      return false;
    }

    // Search CoinGecko for the coin ID
    const coinId = await this.findCoinGeckoId(symbol);
    if (!coinId) {
      this.logger.warn(`CoinGecko ID not found for ${symbol}`);
      return false;
    }

    return this.fetchAndSave(coinId, market.id);
  } 

  // ── Weekly sync of top 200 tokens ────────────────────────────
  // @Cron('0 0 * * 0') // every Sunday at midnight
    @Cron('*/1 * * * *')
  async syncTopTokens() {
    this.logger.log('Starting weekly token metadata sync...');
    const markets = await this.marketRepo.find();
    const symbols  = markets.map(m => m.base); 

    let synced = 0;
    for (const symbol of symbols) {
      try {
        const success = await this.seedToken(symbol);
        if (success) synced++;
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      } catch (err: any) {
        this.logger.warn(`${symbol}: metadata sync failed — ${err?.message}`);
      }
    }

    this.logger.log(`✅ Metadata sync complete: ${synced}/${symbols.length} tokens`);
  }

  // ── CoinGecko search ─────────────────────────────────────────
  private async findCoinGeckoId(symbol: string): Promise<string | null> {
    try {
      const res  = await axios.get(`${COINGECKO_BASE}/search`, {
        params:  { query: symbol },
        timeout: 5_000,
      });
      const coins = res.data?.coins ?? [];
      // Prefer exact symbol match with highest market cap rank
      const match = coins
        .filter((c: any) => c.symbol.toUpperCase() === symbol.toUpperCase())
        .sort((a: any, b: any) => (a.market_cap_rank ?? 9999) - (b.market_cap_rank ?? 9999))[0];

      return match?.id ?? null;
    } catch {
      return null;
    }
  }

  // ── Fetch from CoinGecko and save ────────────────────────────
  private async fetchAndSave(coinId: string, marketId: number): Promise<boolean> {
    try {
      const res = await axios.get(`${COINGECKO_BASE}/coins/${coinId}`, {
        params: {
          localization:        false,
          tickers:             false,
          market_data:         true,
          community_data:      true,
          developer_data:      false,
          sparkline:           false,
        },
        timeout: 8_000,
      });

      const d  = res.data;
      const md = d.market_data;

      const contracts = Object.entries(d.platforms ?? {})
        .filter(([, addr]) => addr)
        .map(([platform, address]) => ({
          chainId:  this.platformToChainId(platform),
          address:  address as string,
          standard: this.platformToStandard(platform),
        }));

      await this.upsert(marketId, {
        name:              d.name,
        symbol:            d.symbol?.toUpperCase(),
        description:       d.description?.en?.slice(0, 5000) ?? null,
        tags:              (d.categories ?? []).slice(0, 20),
        logoUrl:           d.image?.large ?? null,

        // Supply
        circulatingSupply: md?.circulating_supply ?? null,
        totalSupply:       md?.total_supply       ?? null,
        maxSupply:         md?.max_supply         ?? null,
        fdv:               md?.fully_diluted_valuation?.usd ?? null,
        marketCap:         md?.market_cap?.usd             ?? null,

        // ATH / ATL
        ath:     md?.ath?.usd      ?? null,
        athDate: md?.ath_date?.usd ? new Date(md.ath_date.usd) : undefined,
        atl:     md?.atl?.usd      ?? null,
        atlDate: md?.atl_date?.usd ? new Date(md.atl_date.usd) : undefined,

        // Contracts
        contracts,

        // Links
        websites:   (d.links?.homepage ?? []).filter(Boolean).slice(0, 3),
        explorers:  (d.links?.blockchain_site ?? []).filter(Boolean).slice(0, 5),
        whitepaper: d.links?.whitepaper ?? null,

        // Socials
        socials: {
          twitter:  d.links?.twitter_screen_name   ? `https://twitter.com/${d.links.twitter_screen_name}` : '',
          telegram: d.links?.telegram_channel_identifier ? `https://t.me/${d.links.telegram_channel_identifier}` : '',
          reddit:   d.links?.subreddit_url ?? undefined,
          github:   (d.links?.repos_url?.github ?? [])[0] ?? undefined,
          discord:  d.links?.chat_url?.[0] ?? undefined,
        },

        dataSource: 'coingecko',
        externalId: coinId,
      });

      return true;

    } catch (err: any) {
      this.logger.error(`CoinGecko fetch failed for ${coinId}: ${err?.message}`);
      return false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private platformToChainId(platform: string): number {
    const map: Record<string, number> = {
      'ethereum':           1,
      'binance-smart-chain': 56,
      'arbitrum-one':       42161,
      'polygon-pos':        137,
      'base':               8453,
      'optimistic-ethereum': 10,
    };
    return map[platform] ?? 0;
  }

  private platformToStandard(platform: string): string {
    const map: Record<string, string> = {
      'ethereum':            'ERC-20',
      'binance-smart-chain': 'BEP-20',
      'arbitrum-one':        'ERC-20',
      'polygon-pos':         'ERC-20',
      'base':                'ERC-20',
      'optimistic-ethereum': 'ERC-20',
      'solana':              'SPL',
    };
    return map[platform] ?? 'ERC-20';
  }
}
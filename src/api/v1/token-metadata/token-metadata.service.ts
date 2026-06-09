
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { ethers } from 'ethers';
import { TokenMetadataEntity } from './token-metadata.entity';
import { MarketEntity } from '@/market-data/market.entity';

const CG_BASE  = 'https://api.coingecko.com/api/v3';
const CP_BASE  = 'https://api.coinpaprika.com/v1';
const MOB_BASE = 'https://api.mobula.io/api/1';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
];

@Injectable()
export class TokenMetadataService {
  private readonly logger = new Logger(TokenMetadataService.name);

  // source → timestamp when cooldown expires
  private cooldown = new Map<string, number>();

  constructor(
    @InjectRepository(TokenMetadataEntity)
    private readonly metaRepo: Repository<TokenMetadataEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {}

  // ── READ ─────────────────────────────────────────────────────

  async getBySymbol(symbol: string): Promise<TokenMetadataEntity | null> {
    // Normalize symbol — markets.base is stored uppercase
    return this.metaRepo.findOne({
      where: { market: { base: symbol.toUpperCase() } },
      relations: ['market'],
    });
  }

  async getByMarketId(marketId: number): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({ where: { marketId } });
  }

  // ── UPSERT — atomic INSERT … ON CONFLICT DO UPDATE ───────────
  //
  // Key rules:
  //   - Fields explicitly passed as null are stored (intentional null)
  //   - Fields not passed (undefined) are NOT overwritten (don't clobber)
  //   - Empty arrays are skipped unless explicitly passed
  //
  async upsert(marketId: number, data: Partial<TokenMetadataEntity>): Promise<void> {
    // Build payload — keep explicit nulls, skip undefined and empty-but-not-intentional
    const payload: Record<string, any> = { marketId };

    for (const [key, val] of Object.entries(data)) {
      // Skip undefined — field wasn't returned by API at all
      if (val === undefined) continue;
      // Skip empty string unless intentional
      if (val === '') continue;
      // Skip empty arrays — don't clear existing tag/contract arrays with []
      if (Array.isArray(val) && val.length === 0) continue;
      payload[key] = val;
    }

    const updateCols = Object.keys(payload).filter(k => k !== 'marketId');
    if (updateCols.length === 0) return;

    try {
      await this.metaRepo
        .createQueryBuilder()
        .insert()
        .into(TokenMetadataEntity)
        .values(payload as any)
        .orUpdate(updateCols, ['marketId'])
        .execute();

    } catch (err: any) {
      // Fallback: load + merge + save (handles rare concurrent insert edge cases)
      if (err?.code === '23505' || err?.message?.includes('duplicate')) {
        this.logger.warn(`upsert fallback for marketId=${marketId}`);
        const existing = await this.metaRepo.findOne({ where: { marketId } });
        if (existing) {
          for (const [key, val] of Object.entries(payload)) {
            if (key === 'marketId') continue;
            if (val !== undefined) (existing as any)[key] = val;
          }
          await this.metaRepo.save(existing);
        }
      } else {
        throw err;
      }
    }
  }

  // ── SEED ONE TOKEN (on-demand from API) ──────────────────────

  async seedToken(symbol: string): Promise<boolean> {
    const market = await this.marketRepo.findOne({
      where: { base: symbol.toUpperCase() },
    });
    if (!market) {
      this.logger.warn(`seedToken: no market found for symbol '${symbol}'`);
      return false;
    }

    this.logger.log(`Seeding metadata for ${symbol}…`);

    const sources = [
      () => this.fromCoinGecko(symbol.toUpperCase(), market.id),
      () => this.fromCoinPaprika(symbol.toUpperCase(), market.id),
      () => this.fromMobula(symbol.toUpperCase(), market.id),
    ];

    for (const source of sources) {
      const ok = await source();
      if (ok) return true;
      await this.sleep(400 + Math.random() * 200); // jitter
    }

    // Save minimal stub so cron skips for 7 days
    await this.upsert(market.id, {
      name:       symbol,
      symbol:     symbol.toUpperCase(),
      dataSource: 'unavailable',
    });
    this.logger.warn(`${symbol}: no metadata found in any source — stub saved`);
    return false;
  }

  // ── WEEKLY BACKGROUND SYNC ────────────────────────────────────
  //
  // Runs Sunday at 2am — full sync of all markets.
  // Uses batch preload to avoid N+1 queries.
  // Processes ~30 tokens/min to stay within free API rate limits.
  //
  // With 2000 markets at 2s gap: ~67 minutes. Runs in background.
  // No impact on API performance since it's fire-and-forget.
  //
  @Cron('0 2 * * 0')  // Sunday 2:00 AM
    // @Cron('*/1 * * * *')  

  async syncAllTokens(): Promise<void> {
    this.logger.log('🔄 Weekly token metadata sync starting…');

    const markets = await this.marketRepo.find({ select: ['id', 'base'] });
    if (!markets.length) {
      this.logger.warn('No markets found — sync skipped');
      return;
    }

    // ── BATCH PRELOAD (eliminates N+1) ────────────────────────
    // Load all existing metadata in one query, build a Map for O(1) lookup
    const existingList = await this.metaRepo.find({
      select: ['marketId', 'updatedAt', 'dataSource'],
    });
    const existingMap = new Map(
      existingList.map(e => [e.marketId, e])
    );

    const now = Date.now();
    const SIX_DAYS_MS  = 6 * 86_400_000;
    const SEVEN_DAYS_MS = 7 * 86_400_000;

    // Filter markets that actually need syncing
    const toSync = markets.filter(m => {
      const existing = existingMap.get(m.id);

      // Never synced → sync it
      if (!existing) return true;

      const age = now - new Date(existing.updatedAt).getTime();

      // Recently synced (< 6 days) → skip
      if (age < SIX_DAYS_MS) return false;

      // Stub that previously failed all sources → retry after 7 days
      if (existing.dataSource === 'unavailable') return age >= SEVEN_DAYS_MS;

      // Otherwise sync if older than 6 days
      return true;
    });

    this.logger.log(
      `📊 ${markets.length} markets total, ${toSync.length} need syncing, ` +
      `${markets.length - toSync.length} skipped (recent data)`
    );

    let synced = 0;
    for (const m of toSync) {
      const ok = await this.seedToken(m.base);
      if (ok) synced++;

      // 2s gap + jitter → ~28-30 tokens/min, safely under all free tier limits
      await this.sleep(2000 + Math.random() * 400);
    }

    this.logger.log(`✅ Weekly sync complete: ${synced}/${toSync.length} succeeded`);
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 1 — CoinGecko
  // Best data quality. Rate limit: 30 req/min on free tier.
  // ══════════════════════════════════════════════════════════════
  private async fromCoinGecko(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('coingecko')) return false;

    try {
      const searchRes = await axios.get(`${CG_BASE}/search`, {
        params: { query: symbol }, timeout: 6000,
      });

      const coins = searchRes.data?.coins ?? [];
      const match = coins
        .filter((c: any) => c.symbol?.toUpperCase() === symbol)
        .sort((a: any, b: any) => (a.market_cap_rank ?? 9999) - (b.market_cap_rank ?? 9999))[0];

      if (!match?.id) return false;

      const { data: d } = await axios.get(`${CG_BASE}/coins/${match.id}`, {
        params: {
          localization:    false,
          tickers:         false,
          market_data:     true,
          community_data:  false,
          developer_data:  false,
        },
        timeout: 8000,
      });

      const md = d.market_data;

      // Build payload — only include fields that exist in response
      // Using explicit undefined for fields not present = they'll be skipped by upsert()
      const payload: Partial<TokenMetadataEntity> = {
        name:    d.name,
        symbol:  d.symbol?.toUpperCase(),
        logoUrl: d.image?.large ?? undefined,
      };

      if (d.description?.en) {
        payload.description = d.description.en.slice(0, 5000);
      }
      if (Array.isArray(d.categories) && d.categories.length) {
        payload.tags = d.categories.filter(Boolean).slice(0, 20);
      }
      if (md) {
        // Supply — null is intentional (e.g. ETH has no max supply)
        payload.circulatingSupply = md.circulating_supply ?? null;
        payload.totalSupply       = md.total_supply ?? null;
        payload.maxSupply         = md.max_supply ?? null;
        payload.fdv               = md.fully_diluted_valuation?.usd ?? null;
        payload.marketCap         = md.market_cap?.usd ?? null;
        payload.ath               = md.ath?.usd ?? null;
        payload.athDate           = md.ath_date?.usd ? new Date(md.ath_date.usd) : undefined;
        payload.atl               = md.atl?.usd ?? null;
        payload.atlDate           = md.atl_date?.usd ? new Date(md.atl_date.usd) : undefined;
      }

      const contracts = this.parseCGContracts(d.platforms ?? {});
      if (contracts.length) payload.contracts = contracts;

      const websites = (d.links?.homepage ?? []).filter(Boolean).slice(0, 3);
      if (websites.length) payload.websites = websites;

      const explorers = (d.links?.blockchain_site ?? []).filter(Boolean).slice(0, 5);
      if (explorers.length) payload.explorers = explorers;

      if (d.links?.whitepaper) payload.whitepaper = d.links.whitepaper;

      const socials = this.parseCGSocials(d.links ?? {});
      if (Object.keys(socials).length) payload.socials = socials;

      payload.dataSource = 'coingecko';
      payload.externalId = match.id;

      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${symbol}: CoinGecko (${match.id})`);
      return true;

    } catch (err: any) {
      if (err?.response?.status === 429) {
        this.setCooldown('coingecko', 90_000); // 90s cooldown on 429
        this.logger.warn('CoinGecko 429 — cooling 90s');
      } else {
        this.logger.debug(`CoinGecko failed for ${symbol}: ${err?.message}`);
      }
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 2 — CoinPaprika (no API key, 25k calls/month free)
  // ══════════════════════════════════════════════════════════════
  private async fromCoinPaprika(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('coinpaprika')) return false;

    try {
      const searchRes = await axios.get(`${CP_BASE}/search`, {
        params: { q: symbol, c: 'currencies', limit: 10 },
        timeout: 6000,
      });

      const match = (searchRes.data?.currencies ?? [])
        .find((c: any) => c.symbol?.toUpperCase() === symbol);

      if (!match?.id) return false;

      const { data: d } = await axios.get(`${CP_BASE}/coins/${match.id}`, {
        timeout: 6000,
      });

      const payload: Partial<TokenMetadataEntity> = {
        name:   d.name,
        symbol: d.symbol?.toUpperCase(),
        logoUrl:`https://static.coinpaprika.com/coin/${match.id}/logo.png`,
      };

      if (d.description) payload.description = d.description.slice(0, 5000);

      const tags = (d.tags ?? []).map((t: any) => t.name ?? t).filter(Boolean).slice(0, 20);
      if (tags.length) payload.tags = tags;

      // Try to get market data (separate endpoint)
      try {
        const { data: mkt } = await axios.get(`${CP_BASE}/tickers/${match.id}`, {
          timeout: 5000,
        });
        const q = mkt?.quotes?.USD ?? {};
        if (q.market_cap)              payload.marketCap = q.market_cap;
        if (q.fully_diluted_market_cap) payload.fdv       = q.fully_diluted_market_cap;
        if (q.ath_price)               payload.ath        = q.ath_price;
        if (q.ath_date)                payload.athDate    = new Date(q.ath_date);
      } catch (_) { /* ticker endpoint is optional */ }

      if (d.total_supply) payload.circulatingSupply = d.total_supply;

      const contracts = (d.contracts ?? [])
        .filter((c: any) => c.contract)
        .map((c: any) => ({
          chainId:  this.platformToChainId(c.platform ?? ''),
          address:  c.contract,
          standard: 'ERC-20',
        }));
      if (contracts.length) payload.contracts = contracts;

      const websites = [d.links?.website].filter(Boolean);
      if (websites.length) payload.websites = websites;

      if (d.whitepaper?.link) payload.whitepaper = d.whitepaper.link;

      const socials: Record<string, string> = {};
      if (d.links?.twitter)     socials.twitter  = `https://twitter.com/${d.links.twitter}`;
      if (d.links?.telegram)    socials.telegram = `https://t.me/${d.links.telegram}`;
      if (d.links?.reddit)      socials.reddit   = d.links.reddit;
      if (d.links?.github?.[0]) socials.github   = d.links.github[0];
      if (Object.keys(socials).length) payload.socials = socials;

      payload.dataSource = 'coinpaprika';
      payload.externalId = match.id;

      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${symbol}: CoinPaprika (${match.id})`);
      return true;

    } catch (err: any) {
      if (err?.response?.status === 429) {
        this.setCooldown('coinpaprika', 90_000);
        this.logger.warn('CoinPaprika 429 — cooling 90s');
      } else {
        this.logger.debug(`CoinPaprika failed for ${symbol}: ${err?.message}`);
      }
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 3 — Mobula (2.3M tokens, best coverage for DEX tokens)
  // ══════════════════════════════════════════════════════════════
  private async fromMobula(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('mobula')) return false;

    try {
      const searchRes = await axios.get(`${MOB_BASE}/search`, {
        params: { name: symbol }, timeout: 6000,
      });

      const match = (searchRes.data?.data ?? [])
        .find((c: any) => c.symbol?.toUpperCase() === symbol);

      if (!match) return false;

      let d: any = match;

      // Try full market data endpoint
      try {
        const { data: full } = await axios.get(`${MOB_BASE}/market/data`, {
          params: { asset: match.name }, timeout: 6000,
        });
        d = full.data ?? match;
      } catch (_) { /* use search result as fallback */ }

      const payload: Partial<TokenMetadataEntity> = {
        name:   d.name,
        symbol: d.symbol?.toUpperCase(),
      };

      if (d.logo)        payload.logoUrl           = d.logo;
      if (d.description) payload.description       = d.description.slice(0, 5000);
      if (Array.isArray(d.tags) && d.tags.length) payload.tags = d.tags;
      if (d.circulating_supply)   payload.circulatingSupply  = d.circulating_supply;
      if (d.total_supply)         payload.totalSupply         = d.total_supply;
      if (d.market_cap)           payload.marketCap           = d.market_cap;
      if (d.fully_diluted_valuation) payload.fdv              = d.fully_diluted_valuation;

      const contracts = (d.contracts ?? [])
        .filter((c: any) => c.address)
        .map((c: any) => ({
          chainId:  this.platformToChainId(c.blockchain ?? ''),
          address:  c.address,
          standard: 'ERC-20',
        }));
      if (contracts.length) payload.contracts = contracts;

      if (d.website) payload.websites = [d.website];

      const socials: Record<string, string> = {};
      if (d.twitter)  socials.twitter  = d.twitter;
      if (d.telegram) socials.telegram = d.telegram;
      if (Object.keys(socials).length) payload.socials = socials;

      payload.dataSource = 'mobula';
      payload.externalId = String(d.id ?? match.id ?? '');

      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${symbol}: Mobula`);
      return true;

    } catch (err: any) {
      if (err?.response?.status === 429) {
        this.setCooldown('mobula', 60_000);
        this.logger.warn('Mobula 429 — cooling 60s');
      } else {
        this.logger.debug(`Mobula failed for ${symbol}: ${err?.message}`);
      }
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 4 — On-chain ERC-20 (no external API, just RPC)
  // Use for tokens where all 3 APIs failed but contract address is known
  // ══════════════════════════════════════════════════════════════
  async fromOnChain(
    contractAddress: string,
    chainId: number,
    marketId: number,
    rpcUrl: string,
  ): Promise<boolean> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);

      const [nameR, symbolR, decimalsR, supplyR] = await Promise.allSettled([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.totalSupply(),
      ]);

      const name   = nameR.status   === 'fulfilled' ? nameR.value   : null;
      const sym    = symbolR.status === 'fulfilled' ? symbolR.value : null;
      const dec    = decimalsR.status === 'fulfilled' ? Number(decimalsR.value) : 18;
      const supply = supplyR.status  === 'fulfilled'
        ? Number(ethers.formatUnits(supplyR.value, dec))
        : null;

      if (!name && !sym) return false;

      const payload: Partial<TokenMetadataEntity> = {
        name:       name ?? sym,
        symbol:     sym?.toUpperCase(),
        contracts:  [{ chainId, address: contractAddress.toLowerCase(), standard: 'ERC-20' }],
        dataSource: 'onchain',
      };
      if (supply) payload.totalSupply = supply;

      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${sym}: on-chain (${contractAddress.slice(0, 10)}…)`);
      return true;

    } catch (err: any) {
      this.logger.warn(`on-chain fetch failed for ${contractAddress}: ${err?.message}`);
      return false;
    }
  }

  // ── COOLDOWN HELPERS ─────────────────────────────────────────

  private isCooling(source: string): boolean {
    const until = this.cooldown.get(source);
    if (!until) return false;
    if (Date.now() > until) { this.cooldown.delete(source); return false; }
    return true;
  }

  private setCooldown(source: string, ms: number): void {
    this.cooldown.set(source, Date.now() + ms);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── PARSERS ───────────────────────────────────────────────────

  private parseCGContracts(platforms: Record<string, string>) {
    return Object.entries(platforms)
      .filter(([, addr]) => addr)
      .map(([platform, address]) => ({
        chainId:  this.platformToChainId(platform),
        address:  address.toLowerCase(),
        standard: platform === 'solana' ? 'SPL' : 'ERC-20',
      }));
  }

  private parseCGSocials(links: any): Record<string, string> {
    const s: Record<string, string> = {};
    if (links.twitter_screen_name)         s.twitter  = `https://twitter.com/${links.twitter_screen_name}`;
    if (links.telegram_channel_identifier) s.telegram = `https://t.me/${links.telegram_channel_identifier}`;
    if (links.subreddit_url)               s.reddit   = links.subreddit_url;
    if (links.repos_url?.github?.[0])      s.github   = links.repos_url.github[0];
    if (links.chat_url?.[0])               s.discord  = links.chat_url[0];
    return s;
  }

  private platformToChainId(platform: string): number {
    const map: Record<string, number> = {
      ethereum:              1,
      'binance-smart-chain': 56,
      bsc:                   56,
      'arbitrum-one':        42161,
      arbitrum:              42161,
      'polygon-pos':         137,
      polygon:               137,
      base:                  8453,
      'optimistic-ethereum': 10,
      optimism:              10,
      // Case variants from Mobula
      Ethereum:              1,
      BSC:                   56,
      Polygon:               137,
      Arbitrum:              42161,
      Base:                  8453,
      Optimism:              10,
    };
    return map[platform] ?? 0;
  }
}
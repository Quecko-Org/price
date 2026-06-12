// ============================================================
// token-metadata.service.ts — PRODUCTION OPTIMISED
//
// WHY MOST METADATA WAS NULL:
//
// 1. CRON every 1 minute — CoinGecko free: 30 req/min, 10k/month.
//    With 500 markets × 2 calls each = 1000 calls per run × 60 runs/hour
//    = instant 429 flood. All requests fail → null data.
//    FIX: @Cron('0 2 * * 0') — weekly Sunday 2am.
//
// 2. SEARCH + FETCH = 2 API calls per token (slow, rate-limit heavy).
//    FIX: Use /coins/markets endpoint — returns 250 tokens in ONE call.
//    500 markets = 2 calls total instead of 1000.
//
// 3. NO COINGECKO API KEY — free tier now requires demo key for search.
//    FIX: /coins/markets works without key. Register at coingecko.com
//    for a free demo key (100k calls/month) to unlock search endpoint.
//
// NEW STRATEGY — 3-phase sync:
//   Phase 1: CoinGecko /coins/markets (batch, 250 per call)
//            → fills most data in 2-3 API calls for 500 markets
//   Phase 2: CoinPaprika for anything CoinGecko missed
//   Phase 3: Mobula for DEX tokens not on major APIs
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

// CoinGecko /coins/markets returns max 250 per page
const CG_BATCH_SIZE = 250;

@Injectable()
export class TokenMetadataService {
  private readonly logger   = new Logger(TokenMetadataService.name);
  private cooldown          = new Map<string, number>();
  // symbol.toUpperCase() → CoinGecko coin id (built once per sync)
  private cgIdMap           = new Map<string, string>();
  private cgIdMapLoaded     = false;

  constructor(
    @InjectRepository(TokenMetadataEntity)
    private readonly metaRepo: Repository<TokenMetadataEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {}

  // ── READ ─────────────────────────────────────────────────────

  async getBySymbol(symbol: string): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({
      where: { market: { base: symbol.toUpperCase() } },
      relations: ['market'],
    });
  }

  async getByMarketId(marketId: number): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({ where: { marketId } });
  }

  // ── UPSERT ───────────────────────────────────────────────────

  async upsert(marketId: number, data: Partial<TokenMetadataEntity>): Promise<void> {
    const payload: Record<string, any> = { marketId };

    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue;
      if (val === '') continue;
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

  // ── WEEKLY SYNC — Sunday 2am ──────────────────────────────────
  // Phase 1: batch CoinGecko /coins/markets (250 tokens per call)
  // Phase 2: individual fallback for missed tokens
  // Phase 3: Mobula for DEX-only tokens

  @Cron('0 2 * * 0')  // Sunday 2:00 AM — change to '0 2 * * *' for daily
      // @Cron('*/5 * * * *')  

  async syncAllTokens(): Promise<void> {
    this.logger.log('🔄 Token metadata sync starting…');

    const markets = await this.marketRepo.find({ select: ['id', 'base'] });
    if (!markets.length) { this.logger.warn('No markets — skipping'); return; }

    // Batch preload existing metadata
    const existingList = await this.metaRepo.find({
      select: ['marketId', 'updatedAt', 'dataSource'],
    });
    const existingMap = new Map(existingList.map(e => [e.marketId, e]));

    const now          = Date.now();
    const SIX_DAYS_MS  = 6 * 86_400_000;
    const SEVEN_DAYS_MS = 7 * 86_400_000;

    const toSync = markets.filter(m => {
      const e = existingMap.get(m.id);
      if (!e) return true;
      const age = now - new Date(e.updatedAt).getTime();
      if (age < SIX_DAYS_MS) return false;
      if (e.dataSource === 'unavailable') return age >= SEVEN_DAYS_MS;
      return true;
    });

    this.logger.log(`${markets.length} total, ${toSync.length} need sync`);
    if (!toSync.length) return;

    // ── PHASE 1: CoinGecko batch (fastest, most complete) ────────
    const cgFailed = await this.batchFromCoinGecko(toSync);

    this.logger.log(
      `CoinGecko batch done. ${toSync.length - cgFailed.length} succeeded, ` +
      `${cgFailed.length} need fallback`
    );

    // ── PHASE 2: CoinPaprika for CoinGecko misses ─────────────────
    const cpFailed: typeof cgFailed = [];
    for (const m of cgFailed) {
      if (this.isCooling('coinpaprika')) { cpFailed.push(m); continue; }
      const ok = await this.fromCoinPaprika(m.base.toUpperCase(), m.id);
      if (!ok) cpFailed.push(m);
      await this.sleep(500);
    }

    // ── PHASE 3: Mobula for remaining ─────────────────────────────
    let stubCount = 0;
    for (const m of cpFailed) {
      if (this.isCooling('mobula')) { break; }
      const ok = await this.fromMobula(m.base.toUpperCase(), m.id);
      if (!ok) {
        await this.upsert(m.id, { name: m.base, symbol: m.base, dataSource: 'unavailable' });
        stubCount++;
      }
      await this.sleep(500);
    }

    this.logger.log(
      `✅ Sync complete. CG: ${toSync.length - cgFailed.length}, ` +
      `CP: ${cgFailed.length - cpFailed.length}, ` +
      `Mobula: ${cpFailed.length - stubCount}, ` +
      `Unavailable: ${stubCount}`
    );
  }

  // ── PHASE 1: CoinGecko /coins/markets — 250 tokens per call ──
  // Returns array of markets that were NOT found (need fallback)
  private async batchFromCoinGecko(
    markets: { id: number; base: string }[]
  ): Promise<{ id: number; base: string }[]> {

    if (this.isCooling('coingecko')) return markets;

    // Build symbol → coinGecko-id map (one call, ~1800 coins)
    await this.loadCoinGeckoIdMap();

    // Split markets into those we have a CG id for and those we don't
    const withId:    { id: number; base: string; cgId: string }[] = [];
    const withoutId: { id: number; base: string }[]               = [];

    for (const m of markets) {
      const cgId = this.cgIdMap.get(m.base.toUpperCase());
      if (cgId) withId.push({ ...m, cgId });
      else       withoutId.push(m);
    }

    this.logger.log(
      `CoinGecko: ${withId.length} tokens matched in id map, ` +
      `${withoutId.length} unmatched (likely DEX-only)`
    );

    const failed: { id: number; base: string }[] = [...withoutId];

    // Fetch in batches of 250 using /coins/markets
    // This endpoint returns ALL fields we need in one call per 250 tokens
    for (let i = 0; i < withId.length; i += CG_BATCH_SIZE) {
      if (this.isCooling('coingecko')) {
        // Add remaining to failed
        failed.push(...withId.slice(i).map(m => ({ id: m.id, base: m.base })));
        break;
      }

      const batch   = withId.slice(i, i + CG_BATCH_SIZE);
      const cgIds   = batch.map(m => m.cgId).join(',');
      const idToMkt = new Map(batch.map(m => [m.cgId, m]));

      try {
        const { data } = await axios.get(`${CG_BASE}/coins/markets`, {
          params: {
            vs_currency:           'usd',
            ids:                   cgIds,
            order:                 'market_cap_desc',
            per_page:              CG_BATCH_SIZE,
            page:                  1,
            sparkline:             false,
            price_change_percentage: '24h',
          },
          headers: process.env.COINGECKO_API_KEY
            ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
            : {},
          timeout: 15_000,
        });

        for (const coin of (data ?? [])) {
          const mkt = idToMkt.get(coin.id);
          if (!mkt) continue;

          await this.upsert(mkt.id, {
            name:              coin.name,
            symbol:            coin.symbol?.toUpperCase(),
            logoUrl:           coin.image,
            marketCap:         coin.market_cap         ?? null,
            fdv:               coin.fully_diluted_valuation ?? null,
            circulatingSupply: coin.circulating_supply ?? null,
            totalSupply:       coin.total_supply       ?? null,
            maxSupply:         coin.max_supply         ?? null,
            ath:               coin.ath                ?? null,
            athDate:           coin.ath_date           ? new Date(coin.ath_date) : undefined,
            atl:               coin.atl                ?? null,
            atlDate:           coin.atl_date           ? new Date(coin.atl_date) : undefined,
            dataSource:        'coingecko',
            externalId:        coin.id,
          });
        }

        const fetchedIds = new Set((data ?? []).map((c: any) => c.id));
        // Mark tokens not returned by this batch as failed
        for (const m of batch) {
          if (!fetchedIds.has(m.cgId)) failed.push({ id: m.id, base: m.base });
        }

        this.logger.log(
          `CoinGecko batch ${Math.floor(i/CG_BATCH_SIZE)+1}: ` +
          `${data?.length ?? 0}/${batch.length} returned`
        );

        // 2s between batches to respect rate limit
        if (i + CG_BATCH_SIZE < withId.length) await this.sleep(2000);

      } catch (err: any) {
        if (err?.response?.status === 429) {
          this.setCooldown('coingecko', 120_000);
          this.logger.warn('CoinGecko 429 — cooling 2 min');
          failed.push(...batch.map(m => ({ id: m.id, base: m.base })));
        } else if (err?.response?.status === 401) {
          this.logger.error(
            'CoinGecko 401 — API key required.\n' +
            'Register free at https://www.coingecko.com/en/api → Demo plan\n' +
            'Set COINGECKO_API_KEY=your_key in .env'
          );
          failed.push(...withId.slice(i).map(m => ({ id: m.id, base: m.base })));
          break;
        } else {
          this.logger.error(`CoinGecko batch failed: ${err?.message}`);
          failed.push(...batch.map(m => ({ id: m.id, base: m.base })));
        }
        await this.sleep(2000);
      }
    }

    return failed;
  }

  // ── Build symbol → CoinGecko ID map ──────────────────────────
  // /coins/list returns all ~13000 coins with their ids.
  // Called once per sync run, cached in memory.
  // Handles duplicate symbols by preferring higher-ranked coins.
  private async loadCoinGeckoIdMap(): Promise<void> {
    if (this.cgIdMapLoaded) return;

    try {
      this.logger.log('Loading CoinGecko coins list…');
      const { data } = await axios.get(`${CG_BASE}/coins/list`, {
        params: { include_platform: false },
        headers: process.env.COINGECKO_API_KEY
          ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY }
          : {},
        timeout: 15_000,
      });

      this.cgIdMap.clear();

      // Coins list has no rank — we prioritise by a simple rule:
      // well-known IDs like "bitcoin", "ethereum", "tether" win over
      // "bitcoin-cash-sv-2" type variants. Shorter id = more canonical.
      for (const c of (data ?? [])) {
        const sym = c.symbol?.toUpperCase();
        if (!sym) continue;
        const existing = this.cgIdMap.get(sym);
        if (!existing || c.id.length < existing.length) {
          this.cgIdMap.set(sym, c.id);
        }
      }

      this.cgIdMapLoaded = true;
      this.logger.log(`✅ CoinGecko id map loaded: ${this.cgIdMap.size} symbols`);

    } catch (err: any) {
      this.logger.error(`Failed to load CoinGecko id map: ${err?.message}`);
    }
  }

  // ── ON-DEMAND seed from API endpoint ─────────────────────────

  async seedToken(symbol: string): Promise<boolean> {
    const market = await this.marketRepo.findOne({ where: { base: symbol.toUpperCase() } });
    if (!market) { this.logger.warn(`seedToken: no market for '${symbol}'`); return false; }

    this.logger.log(`Seeding ${symbol}…`);

    // Try batch first (most efficient)
    const failed = await this.batchFromCoinGecko([{ id: market.id, base: market.base }]);
    if (!failed.length) return true;

    // Fallback chain
    for (const fn of [
      () => this.fromCoinPaprika(symbol.toUpperCase(), market.id),
      () => this.fromMobula(symbol.toUpperCase(), market.id),
    ]) {
      if (await fn()) return true;
      await this.sleep(400);
    }

    await this.upsert(market.id, { name: symbol, symbol: symbol.toUpperCase(), dataSource: 'unavailable' });
    this.logger.warn(`${symbol}: no metadata found — stub saved`);
    return false;
  }

  // ── CoinPaprika individual fallback ───────────────────────────

  private async fromCoinPaprika(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('coinpaprika')) return false;
    try {
      const { data: sr } = await axios.get(`${CP_BASE}/search`, {
        params: { q: symbol, c: 'currencies', limit: 10 }, timeout: 6000,
      });
      const match = (sr?.currencies ?? []).find((c: any) => c.symbol?.toUpperCase() === symbol);
      if (!match?.id) return false;

      const { data: d } = await axios.get(`${CP_BASE}/coins/${match.id}`, { timeout: 6000 });

      const payload: Partial<TokenMetadataEntity> = {
        name:    d.name,
        symbol:  d.symbol?.toUpperCase(),
        logoUrl: `https://static.coinpaprika.com/coin/${match.id}/logo.png`,
      };
      if (d.description) payload.description = d.description.slice(0, 5000);
      const tags = (d.tags ?? []).map((t: any) => t.name ?? t).filter(Boolean).slice(0, 20);
      if (tags.length) payload.tags = tags;

      try {
        const { data: mkt } = await axios.get(`${CP_BASE}/tickers/${match.id}`, { timeout: 5000 });
        const q = mkt?.quotes?.USD ?? {};
        if (q.market_cap)               payload.marketCap = q.market_cap;
        if (q.fully_diluted_market_cap) payload.fdv       = q.fully_diluted_market_cap;
        if (q.ath_price)                payload.ath       = q.ath_price;
        if (q.ath_date)                 payload.athDate   = new Date(q.ath_date);
      } catch (_) {}

      if (d.total_supply) payload.circulatingSupply = d.total_supply;
      const contracts = (d.contracts ?? []).filter((c: any) => c.contract)
        .map((c: any) => ({ chainId: this.platformToChainId(c.platform ?? ''), address: c.contract, standard: 'ERC-20' }));
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
      this.logger.log(`✅ ${symbol}: CoinPaprika`);
      return true;
    } catch (err: any) {
      if (err?.response?.status === 429) {
        this.setCooldown('coinpaprika', 90_000);
        this.logger.warn('CoinPaprika 429 — cooling 90s');
      }
      return false;
    }
  }

  // ── Mobula individual fallback ────────────────────────────────

  private async fromMobula(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('mobula')) return false;
    try {
      const { data: sr } = await axios.get(`${MOB_BASE}/search`, { params: { name: symbol }, timeout: 6000 });
      const match = (sr?.data ?? []).find((c: any) => c.symbol?.toUpperCase() === symbol);
      if (!match) return false;

      let d: any = match;
      try {
        const { data: full } = await axios.get(`${MOB_BASE}/market/data`, { params: { asset: match.name }, timeout: 6000 });
        d = full.data ?? match;
      } catch (_) {}

      const payload: Partial<TokenMetadataEntity> = { name: d.name, symbol: d.symbol?.toUpperCase() };
      if (d.logo)                      payload.logoUrl           = d.logo;
      if (d.description)               payload.description       = d.description.slice(0, 5000);
      if (d.tags?.length)              payload.tags              = d.tags;
      if (d.circulating_supply)        payload.circulatingSupply = d.circulating_supply;
      if (d.total_supply)              payload.totalSupply       = d.total_supply;
      if (d.market_cap)                payload.marketCap         = d.market_cap;
      if (d.fully_diluted_valuation)   payload.fdv               = d.fully_diluted_valuation;
      const contracts = (d.contracts ?? []).filter((c: any) => c.address)
        .map((c: any) => ({ chainId: this.platformToChainId(c.blockchain ?? ''), address: c.address, standard: 'ERC-20' }));
      if (contracts.length) payload.contracts = contracts;
      if (d.website) payload.websites = [d.website];
      const socials: Record<string, string> = {};
      if (d.twitter)  socials.twitter  = d.twitter;
      if (d.telegram) socials.telegram = d.telegram;
      if (Object.keys(socials).length) payload.socials = socials;
      payload.dataSource = 'mobula';
      payload.externalId = String(d.id ?? '');

      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${symbol}: Mobula`);
      return true;
    } catch (err: any) {
      if (err?.response?.status === 429) { this.setCooldown('mobula', 60_000); this.logger.warn('Mobula 429 — cooling 60s'); }
      return false;
    }
  }

  // ── On-chain ERC-20 ───────────────────────────────────────────

  async fromOnChain(contractAddress: string, chainId: number, marketId: number, rpcUrl: string): Promise<boolean> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      const [nameR, symbolR, decimalsR, supplyR] = await Promise.allSettled([
        contract.name(), contract.symbol(), contract.decimals(), contract.totalSupply(),
      ]);
      const name   = nameR.status   === 'fulfilled' ? nameR.value   : null;
      const sym    = symbolR.status === 'fulfilled' ? symbolR.value : null;
      const dec    = decimalsR.status === 'fulfilled' ? Number(decimalsR.value) : 18;
      const supply = supplyR.status  === 'fulfilled' ? Number(ethers.formatUnits(supplyR.value, dec)) : null;
      if (!name && !sym) return false;
      const payload: Partial<TokenMetadataEntity> = {
        name: name ?? sym, symbol: sym?.toUpperCase(),
        contracts: [{ chainId, address: contractAddress.toLowerCase(), standard: 'ERC-20' }],
        dataSource: 'onchain',
      };
      if (supply) payload.totalSupply = supply;
      await this.upsert(marketId, payload);
      this.logger.log(`✅ ${sym}: on-chain`);
      return true;
    } catch (err: any) {
      this.logger.warn(`on-chain failed for ${contractAddress}: ${err?.message}`);
      return false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private isCooling(source: string): boolean {
    const until = this.cooldown.get(source);
    if (!until) return false;
    if (Date.now() > until) { this.cooldown.delete(source); return false; }
    return true;
  }
  private setCooldown(source: string, ms: number): void { this.cooldown.set(source, Date.now() + ms); }
  private sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

  private parseCGContracts(platforms: Record<string, string>) {
    return Object.entries(platforms).filter(([, a]) => a)
      .map(([p, address]) => ({ chainId: this.platformToChainId(p), address: address.toLowerCase(), standard: p === 'solana' ? 'SPL' : 'ERC-20' }));
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
  private platformToChainId(p: string): number {
    return ({
      ethereum:1,'binance-smart-chain':56,bsc:56,'arbitrum-one':42161,arbitrum:42161,
      'polygon-pos':137,polygon:137,base:8453,'optimistic-ethereum':10,optimism:10,
      Ethereum:1,BSC:56,Polygon:137,Arbitrum:42161,Base:8453,Optimism:10,
    } as Record<string,number>)[p] ?? 0;
  }
}
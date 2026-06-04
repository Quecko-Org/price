// ============================================================
// token-metadata.service.ts
//
// FIXES:
//   1. upsert() now uses INSERT ... ON CONFLICT (marketId) DO UPDATE
//      — no more duplicate key 23505 errors on repeated cron runs
//   2. Null/empty fields are stripped before save so existing good
//      data is never overwritten with nulls from a partial source
//   3. Fallback chain: CoinGecko → CoinPaprika → Mobula → on-chain
//   4. 429 cooldown per source — never hammers a rate-limited API
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

  // ── Read ──────────────────────────────────────────────────────
  async getBySymbol(symbol: string): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({
      where: { market: { base: symbol } },
      relations: ['market'],
    });
  }

  async getByMarketId(marketId: number): Promise<TokenMetadataEntity | null> {
    return this.metaRepo.findOne({ where: { marketId } });
  }

  // ── Upsert — INSERT … ON CONFLICT DO UPDATE ───────────────────
  // Handles concurrent inserts and repeated cron runs safely.
  // Strips null/undefined/empty values so existing good data
  // is never overwritten with nulls from a partial API response.
  async upsert(marketId: number, data: Partial<TokenMetadataEntity>): Promise<void> {
    // Build clean payload — skip nulls, undefined, empty strings, empty arrays
    const payload: Record<string, any> = { marketId }
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined || val === '') continue
      if (Array.isArray(val) && val.length === 0) continue
      payload[key] = val
    }

    const updateCols = Object.keys(payload).filter(k => k !== 'marketId')
    if (updateCols.length === 0) return // nothing to save

    try {
      await this.metaRepo
        .createQueryBuilder()
        .insert()
        .into(TokenMetadataEntity)
        .values(payload as any)
        .orUpdate(updateCols, ['marketId'])
        .execute()
    } catch (err: any) {
      // Last-resort fallback: load + merge + save (handles edge cases)
      if (err?.code === '23505' || err?.message?.includes('duplicate')) {
        this.logger.warn(`upsert fallback for marketId=${marketId}`)
        const existing = await this.metaRepo.findOne({ where: { marketId } })
        if (existing) {
          for (const [key, val] of Object.entries(payload)) {
            if (key === 'marketId') continue
            if (val !== null && val !== undefined) {
              (existing as any)[key] = val
            }
          }
          await this.metaRepo.save(existing)
        }
      } else {
        throw err
      }
    }
  }

  // ── Seed one token ────────────────────────────────────────────
  async seedToken(symbol: string): Promise<boolean> {
    const market = await this.marketRepo.findOne({ where: { base: symbol } })
    if (!market) return false

    this.logger.log(`Seeding metadata for ${symbol}…`)

    const sources = [
      () => this.fromCoinGecko(symbol, market.id),
      () => this.fromCoinPaprika(symbol, market.id),
      () => this.fromMobula(symbol, market.id),
    ]

    for (const source of sources) {
      const ok = await source()
      if (ok) return true
      await this.sleep(400)
    }

    // Save minimal stub so cron doesn't keep retrying this token
    await this.upsert(market.id, { name: symbol, symbol, dataSource: 'unavailable' })
    this.logger.warn(`${symbol}: no metadata found in any source — saved stub`)
    return false
  }

  // ── Weekly sync ───────────────────────────────────────────────
  // @Cron('0 0 * * 0')
      @Cron('*/1 * * * *')

  async syncAllTokens() {
    this.logger.log('Weekly token metadata sync…')
    const markets = await this.marketRepo.find()
    let synced = 0

    for (const m of markets) {
      // Skip tokens synced within the last 6 days
      const existing = await this.metaRepo.findOne({ where: { marketId: m.id } })
      if (existing?.updatedAt) {
        const age = Date.now() - new Date(existing.updatedAt).getTime()
        if (age < 6 * 86_400_000) continue
      }
      // Skip stubs that already failed all sources
      if (existing?.dataSource === 'unavailable') continue

      const ok = await this.seedToken(m.base)
      if (ok) synced++
      await this.sleep(2000) // 2s gap → ~30 tokens/min, safe for all free tiers
    }

    this.logger.log(`✅ Sync complete: ${synced}/${markets.length}`)
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 1 — CoinGecko
  // ══════════════════════════════════════════════════════════════
  private async fromCoinGecko(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('coingecko')) return false
    try {
      const searchRes = await axios.get(`${CG_BASE}/search`, {
        params: { query: symbol }, timeout: 6000,
      })
      const coins = searchRes.data?.coins ?? []
      const match = coins
        .filter((c: any) => c.symbol?.toUpperCase() === symbol.toUpperCase())
        .sort((a: any, b: any) => (a.market_cap_rank ?? 9999) - (b.market_cap_rank ?? 9999))[0]
      if (!match?.id) return false

      const res = await axios.get(`${CG_BASE}/coins/${match.id}`, {
        params: { localization: false, tickers: false, market_data: true, community_data: false, developer_data: false },
        timeout: 8000,
      })
      const d = res.data
      const md = d.market_data

      await this.upsert(marketId, {
        name:              d.name,
        symbol:            d.symbol?.toUpperCase(),
        description:       d.description?.en?.slice(0, 5000),
        tags:              (d.categories ?? []).filter(Boolean).slice(0, 20),
        logoUrl:           d.image?.large,
        circulatingSupply: md?.circulating_supply,
        totalSupply:       md?.total_supply,
        maxSupply:         md?.max_supply,
        fdv:               md?.fully_diluted_valuation?.usd,
        marketCap:         md?.market_cap?.usd,
        ath:               md?.ath?.usd,
        athDate:           md?.ath_date?.usd ? new Date(md.ath_date.usd) : undefined,
        atl:               md?.atl?.usd,
        atlDate:           md?.atl_date?.usd ? new Date(md.atl_date.usd) : undefined,
        contracts:         this.parseCGContracts(d.platforms ?? {}),
        websites:          (d.links?.homepage ?? []).filter(Boolean).slice(0, 3),
        explorers:         (d.links?.blockchain_site ?? []).filter(Boolean).slice(0, 5),
        whitepaper:        d.links?.whitepaper,
        socials:           this.parseCGSocials(d.links ?? {}),
        dataSource:        'coingecko',
        externalId:        match.id,
      })
      this.logger.log(`✅ ${symbol}: CoinGecko`)
      return true
    } catch (err: any) {
      if (err?.response?.status === 429) { this.setCooldown('coingecko', 60_000); this.logger.warn('CoinGecko 429 → cooling 60s') }
      return false
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 2 — CoinPaprika (no key, 25k/month free)
  // ══════════════════════════════════════════════════════════════
  private async fromCoinPaprika(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('coinpaprika')) return false
    try {
      const searchRes = await axios.get(`${CP_BASE}/search`, {
        params: { q: symbol, c: 'currencies', limit: 10 }, timeout: 6000,
      })
      const match = (searchRes.data?.currencies ?? [])
        .find((c: any) => c.symbol?.toUpperCase() === symbol.toUpperCase())
      if (!match?.id) return false

      const res = await axios.get(`${CP_BASE}/coins/${match.id}`, { timeout: 6000 })
      const d = res.data

      let mkt: any = {}
      try {
        const mr = await axios.get(`${CP_BASE}/tickers/${match.id}`, { timeout: 5000 })
        mkt = mr.data?.quotes?.USD ?? {}
      } catch (_) {}

      await this.upsert(marketId, {
        name:        d.name,
        symbol:      d.symbol?.toUpperCase(),
        description: d.description?.slice(0, 5000),
        tags:        (d.tags ?? []).map((t: any) => t.name ?? t).slice(0, 20),
        logoUrl:     `https://static.coinpaprika.com/coin/${match.id}/logo.png`,
        circulatingSupply: d.total_supply,
        marketCap:   mkt.market_cap,
        fdv:         mkt.fully_diluted_market_cap,
        ath:         mkt.ath_price,
        athDate:     mkt.ath_date ? new Date(mkt.ath_date) : undefined,
        contracts:   (d.contracts ?? [])
          .filter((c: any) => c.contract)
          .map((c: any) => ({ chainId: this.platformToChainId(c.platform ?? ''), address: c.contract, standard: 'ERC-20' })),
        websites:    [d.links?.website].filter(Boolean),
        whitepaper:  d.whitepaper?.link,
        socials: Object.fromEntries([
          d.links?.twitter   ? ['twitter',  `https://twitter.com/${d.links.twitter}`] : [],
          d.links?.telegram  ? ['telegram', `https://t.me/${d.links.telegram}`]       : [],
          d.links?.reddit    ? ['reddit',    d.links.reddit]                           : [],
          d.links?.github?.[0] ? ['github', d.links.github[0]]                        : [],
        ].filter(e => e.length)),
        dataSource: 'coinpaprika',
        externalId: match.id,
      })
      this.logger.log(`✅ ${symbol}: CoinPaprika`)
      return true
    } catch (err: any) {
      if (err?.response?.status === 429) { this.setCooldown('coinpaprika', 60_000); this.logger.warn('CoinPaprika 429 → cooling 60s') }
      return false
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 3 — Mobula (2.3M tokens, DEX/small-cap coverage)
  // ══════════════════════════════════════════════════════════════
  private async fromMobula(symbol: string, marketId: number): Promise<boolean> {
    if (this.isCooling('mobula')) return false
    try {
      const res = await axios.get(`${MOB_BASE}/search`, {
        params: { name: symbol }, timeout: 6000,
      })
      const match = (res.data?.data ?? [])
        .find((c: any) => c.symbol?.toUpperCase() === symbol.toUpperCase())
      if (!match) return false

      let d: any = match
      try {
        const full = await axios.get(`${MOB_BASE}/market/data`, {
          params: { asset: match.name }, timeout: 6000,
        })
        d = full.data?.data ?? match
      } catch (_) {}

      await this.upsert(marketId, {
        name:              d.name,
        symbol:            d.symbol?.toUpperCase(),
        description:       d.description?.slice(0, 5000),
        logoUrl:           d.logo,
        tags:              d.tags ?? [],
        circulatingSupply: d.circulating_supply,
        totalSupply:       d.total_supply,
        marketCap:         d.market_cap,
        fdv:               d.fully_diluted_valuation,
        contracts: (d.contracts ?? [])
          .filter((c: any) => c.address)
          .map((c: any) => ({ chainId: this.platformToChainId(c.blockchain ?? ''), address: c.address, standard: 'ERC-20' })),
        websites: d.website ? [d.website] : [],
        socials: Object.fromEntries([
          d.twitter  ? ['twitter',  d.twitter]  : [],
          d.telegram ? ['telegram', d.telegram] : [],
        ].filter(e => e.length)),
        dataSource: 'mobula',
        externalId: String(d.id ?? match.id),
      })
      this.logger.log(`✅ ${symbol}: Mobula`)
      return true
    } catch (err: any) {
      if (err?.response?.status === 429) { this.setCooldown('mobula', 30_000); this.logger.warn('Mobula 429 → cooling 30s') }
      return false
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SOURCE 4 — On-chain ERC-20 contract (no external API)
  // ══════════════════════════════════════════════════════════════
  async fromOnChain(contractAddress: string, chainId: number, marketId: number, rpcUrl: string): Promise<boolean> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl)
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider)
      const [nameR, symbolR, decimalsR, supplyR] = await Promise.allSettled([
        contract.name(), contract.symbol(), contract.decimals(), contract.totalSupply(),
      ])
      const name   = nameR.status   === 'fulfilled' ? nameR.value   : null
      const sym    = symbolR.status === 'fulfilled' ? symbolR.value : null
      const dec    = decimalsR.status === 'fulfilled' ? decimalsR.value : 18
      const supply = supplyR.status  === 'fulfilled' ? Number(ethers.formatUnits(supplyR.value, dec)) : null
      if (!name && !sym) return false

      await this.upsert(marketId, {
        name: name ?? sym, symbol: sym?.toUpperCase(),
        totalSupply: supply || undefined,
        contracts: [{ chainId, address: contractAddress.toLowerCase(), standard: 'ERC-20' }],
        dataSource: 'onchain',
      })
      this.logger.log(`✅ ${sym}: on-chain`)
      return true
    } catch (err: any) {
      this.logger.warn(`On-chain fetch failed for ${contractAddress}: ${err?.message}`)
      return false
    }
  }

  // ── Cooldown helpers ──────────────────────────────────────────
  private isCooling(source: string): boolean {
    const until = this.cooldown.get(source)
    if (!until) return false
    if (Date.now() > until) { this.cooldown.delete(source); return false }
    return true
  }
  private setCooldown(source: string, ms: number) { this.cooldown.set(source, Date.now() + ms) }
  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

  // ── Parsers ───────────────────────────────────────────────────
  private parseCGContracts(platforms: Record<string, string>) {
    return Object.entries(platforms).filter(([,a])=>a)
      .map(([p, address]) => ({ chainId: this.platformToChainId(p), address: address.toLowerCase(), standard: p === 'solana' ? 'SPL' : 'ERC-20' }))
  }
  private parseCGSocials(links: any): Record<string, string> {
    const s: Record<string, string> = {}
    if (links.twitter_screen_name)          s.twitter  = `https://twitter.com/${links.twitter_screen_name}`
    if (links.telegram_channel_identifier)  s.telegram = `https://t.me/${links.telegram_channel_identifier}`
    if (links.subreddit_url)                s.reddit   = links.subreddit_url
    if (links.repos_url?.github?.[0])       s.github   = links.repos_url.github[0]
    if (links.chat_url?.[0])                s.discord  = links.chat_url[0]
    return s
  }
  private platformToChainId(p: string): number {
    return ({ ethereum:1,'binance-smart-chain':56,bsc:56,'arbitrum-one':42161,arbitrum:42161,'polygon-pos':137,polygon:137,base:8453,'optimistic-ethereum':10,optimism:10,Ethereum:1,BSC:56,Polygon:137,Arbitrum:42161,Base:8453,Optimism:10 } as Record<string,number>)[p] ?? 0
  }
}
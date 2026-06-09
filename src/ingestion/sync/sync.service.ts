
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SymbolExchangeEntity } from '@/ingestion/symbols/entities/symbol-exchange.entity';
import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import { BinanceService } from '@/ingestion/exchanges/binance/binance.service';
import { MexcService } from '@/ingestion/exchanges/mexc/mexc.service';
import { OkxService } from '@/ingestion/exchanges/okx/okx.service';
import { Exchange } from '@/common/enums/exchanges.enums';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
import { RedisService } from '@/common-module/redis/redis.service';
import { ExchangeTicker } from '../symbols/exchange-market-data.interface';

// Only fetch depth for top N symbols by volume — avoid rate limits
const DEPTH_SYMBOL_LIMIT = 50;

@Injectable()
export class MarketDataSyncService {
  private readonly logger      = new Logger(MarketDataSyncService.name);
  private syncRunning          = false;
  private tickerRunning        = false;
  private depthRunning         = false;

  constructor(
    @InjectRepository(SymbolExchangeEntity)
    private readonly seRepo: Repository<SymbolExchangeEntity>,
    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    private readonly binance:     BinanceService,
    private readonly mexc:        MexcService,
    private readonly okx:         OkxService,
    private readonly priceCache:  PriceCacheService,
    private readonly redis:       RedisService,
  ) {}

  // ── SYMBOL SYNC — every 30 minutes ───────────────────────────
  // Symbols change rarely (new listings, delistings).
  // SymbolsService uses Redis hash — if nothing changed, DB write is skipped.
  // Running every 30min is more than frequent enough.
  // @Cron('0 */30 * * * *')
  @Cron('*/1 * * * *')  
  async syncAllExchanges() {
    if (this.syncRunning) {
      this.logger.warn('Symbol sync already running — skipping');
      return;
    }
    this.syncRunning = true;
    this.logger.log('🔄 Symbol sync starting...');

    try {
      // Serial — prevents deadlocks from concurrent upserts on same tables
      await this.runSafe('Binance', () => this.binance.fetchAndStoreSymbols());
      await this.runSafe('MEXC',    () => this.mexc.fetchAndStoreSymbols());
      await this.runSafe('OKX',     () => this.okx.fetchAndStoreSymbols());
      this.logger.log('✅ Symbol sync complete');
    } finally {
      this.syncRunning = false;
    }
  }

  // ── TICKER SYNC — every 60 seconds ───────────────────────────
  // One batch API call per exchange → all symbols in ~150ms.
  // Writes price, volume, bid/ask for every active symbol.
  // Parallel — each exchange is independent.
  @Cron('0 * * * * *')
  async syncTickers() {
    if (this.tickerRunning) {
      this.logger.debug('Ticker sync already running — skipping');
      return;
    }
    this.tickerRunning = true;
    try {
      await Promise.allSettled([
        this.syncExchangeTickers(Exchange.BINANCE, () => this.binance.fetchAllTickers()),
        this.syncExchangeTickers(Exchange.MEXC,    () => this.mexc.fetchAllTickers()),
        this.syncExchangeTickers(Exchange.OKX,     () => this.okx.fetchAllTickers()),
      ]);
    } finally {
      this.tickerRunning = false;
    }
  }

  // ── DEPTH SYNC — every 5 minutes, top 50 symbols ─────────────
  // Depth requires one HTTP call per symbol → expensive.
  // 50 symbols × 100ms gap = 5s per exchange per run.
  // Running every 5min is right — daily trading depth doesn't change faster.
  @Cron('0 */5 * * * *')
  async syncDepth() {
    if (this.depthRunning) {
      this.logger.debug('Depth sync already running — skipping');
      return;
    }
    this.depthRunning = true;
    try {
      await Promise.allSettled([
        this.syncExchangeDepth(Exchange.BINANCE, (sym, mid) => this.binance.fetchDepth(sym, mid)),
        this.syncExchangeDepth(Exchange.MEXC,    (sym, mid) => this.mexc.fetchDepth(sym, mid)),
        this.syncExchangeDepth(Exchange.OKX,     (sym, mid) => this.okx.fetchDepth(sym, mid)),
      ]);
    } finally {
      this.depthRunning = false;
    }
  }

  // ── CORE: ticker sync for one exchange ────────────────────────
  private async syncExchangeTickers(
    exchange: Exchange,
    fetchFn: () => Promise<ExchangeTicker[]>,
  ): Promise<void> {
    try {
      const tickers = await fetchFn();
      if (!tickers.length) return;

      // Build ticker lookup: symbol string → ticker
      const tickerMap = new Map<string, ExchangeTicker>(
        tickers.map(t => [t.symbol, t])
      );

      // Load DB rows — select only needed fields (no heavy eager loads)
      const rows = await this.seRepo.find({
        where:     { exchange, isActive: true },
        relations: ['symbol'],
        select:    {
          id: true, lastPrice: true,
          symbol: { id: true, symbol: true },
        },
      });

      if (!rows.length) return;

      const toSave: SymbolExchangeEntity[]  = [];
      const redisOps: Promise<any>[]        = [];
      const priceUpdates: [string, number][] = [];

      for (const row of rows) {
        // Strip hyphen for OKX symbols (BTC-USDT → BTCUSDT)
        const lookupKey = row.symbol.symbol.replace('-', '');
        const ticker    = tickerMap.get(lookupKey);
        if (!ticker) continue;

        const mid    = ticker.lastPrice;
        const spread = (mid > 0 && ticker.askPrice > 0 && ticker.bidPrice > 0)
          ? ((ticker.askPrice - ticker.bidPrice) / mid) * 100
          : null;

        row.lastPrice      = ticker.lastPrice;
        row.priceChange24h = ticker.priceChange24h;
        row.high24h        = ticker.high24h;
        row.low24h         = ticker.low24h;
        row.volume24hBase  = ticker.volume24hBase;
        row.volume24hUsd   = ticker.volume24hQuote;
        row.bidPrice       = ticker.bidPrice;
        row.askPrice       = ticker.askPrice;
        row.spreadPct      = spread;

        toSave.push(row);

        // Queue Redis cache update (TTL 90s)
        redisOps.push(
          this.redis.setex(
            `exchange:ticker:${exchange}:${row.symbol.symbol}`,
            90,
            JSON.stringify({
              price: mid, change24h: ticker.priceChange24h,
              high24h: ticker.high24h, low24h: ticker.low24h,
              volume24hBase: ticker.volume24hBase, volume24hUsd: ticker.volume24hQuote,
              bid: ticker.bidPrice, ask: ticker.askPrice,
              spread, updatedAt: Date.now(),
            })
          )
        );

        // Track prices to update PriceCacheService
        if (mid > 0) priceUpdates.push([row.symbol?.['base'] ?? '', mid]);
      }

      // Bulk save in chunks — avoids query length limits
      for (let i = 0; i < toSave.length; i += 500) {
        await this.seRepo.save(toSave.slice(i, i + 500));
      }

      // Fire all Redis writes in parallel — don't block on them
      await Promise.allSettled(redisOps);

      // Update in-memory price cache (for DEX normalizeToUSD)
      for (const [base, price] of priceUpdates) {
        if (base) this.priceCache.updateCryptoPrice(base, price);
      }

      this.logger.log(`✅ ${exchange} tickers: ${toSave.length} updated`);

    } catch (err: any) {
      this.logger.error(`${exchange} ticker sync failed: ${err?.message}`);
    }
  }

  // ── CORE: depth sync for top symbols ─────────────────────────
  private async syncExchangeDepth(
    exchange: Exchange,
    fetchFn: (symbol: string, mid: number) => Promise<any>,
  ): Promise<void> {
    try {
      // Top N symbols by volume — depth data is only useful for liquid markets
      const rows = await this.seRepo.find({
        where:     { exchange, isActive: true },
        relations: ['symbol'],
        order:     { volume24hUsd: 'DESC' },
        take:      DEPTH_SYMBOL_LIMIT,
        select:    { id: true, lastPrice: true, depthBid2pct: true, depthAsk2pct: true, symbol: { id: true, symbol: true } },
      });

      const toSave: SymbolExchangeEntity[] = [];

      for (const row of rows) {
        if (!row.lastPrice) continue;

        const depth = await fetchFn(row.symbol.symbol, row.lastPrice);
        if (!depth) continue;

        row.depthBid2pct = depth.bidDepth2pct;
        row.depthAsk2pct = depth.askDepth2pct;
        toSave.push(row);

        // 100ms gap between calls to respect rate limits
        await new Promise(r => setTimeout(r, 100));
      }

      // Batch save — was row-by-row (50 individual saves), now one bulk save
      if (toSave.length) {
        await this.seRepo.save(toSave);
      }

      this.logger.log(`✅ ${exchange} depth: ${toSave.length} updated`);

    } catch (err: any) {
      this.logger.error(`${exchange} depth sync failed: ${err?.message}`);
    }
  }

  // ── SAFE WRAPPER ─────────────────────────────────────────────
  private async runSafe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
        this.logger.warn(`${name}: network unreachable — skipping this cycle`);
      } else if (msg.includes('40P01')) {
        this.logger.error(`${name}: deadlock detected — check for concurrent writers`);
      } else {
        this.logger.error(`${name}: sync failed — ${msg}`);
      }
    }
  }
}
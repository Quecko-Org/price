

// ============================================================
// market-data-sync.service.ts
//
// Fetches per-exchange ticker + depth and writes to
// symbol_exchanges table. Runs on a cron schedule.
//
// UPDATE FREQUENCIES:
//   Ticker (price, volume, bid/ask): every 60s
//     — Binance /ticker/24hr = one call for ALL symbols (~150ms)
//     — MEXC same approach
//     — Fast enough for live display, cheap on rate limits
//
//   Depth (order book 2% band): every 5 min, top 50 symbols only
//     — One HTTP call per symbol → expensive
//     — Only top symbols by volume need depth data
//     — Rate limit: Binance 1200/min, MEXC 500/min
//
// HOW SYMBOL MATCHING WORKS:
//   Exchange symbol:  BTCUSDT  (Binance format)
//   DB symbol_exchanges row has: symbol → symbols.symbol = BTCUSDT
//   Match on exact symbol string after fetching the DB symbol map.
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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

// Only fetch depth for top N symbols by volume — rest get null depth
const DEPTH_SYMBOL_LIMIT = 50;

@Injectable()
export class MarketDataSyncService {
  private readonly logger = new Logger(MarketDataSyncService.name);
  private syncRunning      = false;

  constructor(
    @InjectRepository(SymbolExchangeEntity)
    private readonly seRepo: Repository<SymbolExchangeEntity>,

    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,

    private readonly binance: BinanceService,
    private readonly mexc: MexcService,
    private readonly okx: OkxService,
    private readonly priceCache: PriceCacheService,
    private readonly redis: RedisService,
  ) { }




  // @Cron('*/30 * * * *') 
  @Cron('*/1 * * * *')  
async syncAllExchanges() {
    if (this.syncRunning) {
      this.logger.warn('Symbol sync already running — skipping this tick');
      return;
    }
 
    this.syncRunning = true;
    this.logger.log('🔄 Symbol sync starting (serial)...');
 
    try {
      // ✅ SERIAL — one after another, no concurrent transactions
      // This is the only change needed to fix deadlock.
 
      this.logger.log('  → Binance...');
      await this.runSafe('Binance', () => this.binance.fetchAndStoreSymbols());
 
      this.logger.log('  → MEXC...');
      await this.runSafe('MEXC', () => this.mexc.fetchAndStoreSymbols());
 
      this.logger.log('  → OKX...');
      await this.runSafe('OKX', () => this.okx.fetchAndStoreSymbols());
 
      this.logger.log('✅ Symbol sync complete');
 
    } finally {
      this.syncRunning = false;
    }
  }
 
  // ── Safe wrapper: catches DNS/network errors per exchange ─────
  // OKX may be blocked by network (ENOTFOUND ws.okx.com).
  // Don't let one exchange failure block the others.
  private async runSafe(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err: any) {
      console.log("lllll",err)
      const msg = err?.message ?? String(err);
 
      if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
        this.logger.warn(
          `${name}: network unreachable (${msg}) — skipping this sync cycle`
        );
      } else if (msg.includes('40P01')) {
        // Deadlock slipped through — log clearly
        this.logger.error(
          `${name}: deadlock error — this should not happen with serial sync. ` +
          `Check if another process is also writing to symbols/markets tables.`
        );
      } else {
        this.logger.error(`${name}: sync failed — ${err}`);
      }
    }
  }







  // ── TICKER REFRESH — every 60 seconds ────────────────────
  // One batch call per exchange → write to DB + Redis
   @Cron('0 * * * * *') // every 60s at :00
  async syncTickers() {
    await Promise.all([
      // this.syncExchangeTickers(Exchange.BINANCE, () => this.binance.fetchAllTickers()),
      // this.syncExchangeTickers(Exchange.MEXC, () => this.mexc.fetchAllTickers()),
      this.syncExchangeTickers(Exchange.OKX, () => this.okx.fetchAllTickers()),
    ]);
  }

  // ── DEPTH REFRESH — every 5 minutes, top 50 symbols ──────
  @Cron('0 */1 * * * *') // every 5 min at :00
  async syncDepth() {
    await Promise.all([
      // this.syncExchangeDepth(Exchange.BINANCE, (sym, mid) => this.binance.fetchDepth(sym, mid)),
      // this.syncExchangeDepth(Exchange.MEXC, (sym, mid) => this.mexc.fetchDepth(sym, mid)),
      this.syncExchangeDepth(Exchange.OKX, (sym, mid) => this.okx.fetchDepth(sym, mid)),
    ]);
    // OKX depth API requires auth for higher limits — skip for now
  }

  // ── CORE: sync one exchange's tickers ────────────────────
  private async syncExchangeTickers(
    exchange: Exchange,
    fetchFn: () => Promise<ExchangeTicker[]>,
  ) {
    try {
      const tickers = await fetchFn();

      if (!tickers.length) return;
 
      // Build lookup: exchangeSymbol → ticker
      const tickerMap = new Map<string, ExchangeTicker>();

      for (const t of tickers) tickerMap.set(t.symbol, t);

      // Load all active symbol_exchange rows for this exchange
      const rows = await this.seRepo.find({
        where: { exchange, isActive: true },
        relations: ['symbol'],
      });
      // console.log("lllllllll",rows.length)

      if (!rows.length) return;

      const toSave: SymbolExchangeEntity[] = [];
      const redisUpdates: Promise<any>[] = [];

      for (const row of rows) {
        const ticker = tickerMap.get(row.symbol.symbol.replace('-', ''));
        if (!ticker) continue; // symbol not in ticker response (delisted/unavailable)

        const mid = ticker.lastPrice;
        const spread = mid > 0 && ticker.askPrice > 0 && ticker.bidPrice > 0
          ? ((ticker.askPrice - ticker.bidPrice) / mid) * 100
          : null;

        // Update fields
        row.lastPrice = ticker.lastPrice;
        row.priceChange24h = ticker.priceChange24h;
        row.high24h = ticker.high24h;
        row.low24h = ticker.low24h;
        row.volume24hBase = ticker.volume24hBase;
        row.volume24hUsd = ticker.volume24hQuote; // USDT = USD
        row.bidPrice = ticker.bidPrice;
        row.askPrice = ticker.askPrice;
        row.spreadPct = spread;

        toSave.push(row);

        // Cache per-exchange stats in Redis for fast API reads
        // Key: exchange:ticker:{exchange}:{symbol}  TTL: 90s
        redisUpdates.push(
          this.redis.setex(
            `exchange:ticker:${exchange}:${row.symbol.symbol}`,
            90,
            JSON.stringify({
              price: ticker.lastPrice,
              change24h: ticker.priceChange24h,
              high24h: ticker.high24h,
              low24h: ticker.low24h,
              volume24hBase: ticker.volume24hBase,
              volume24hUsd: ticker.volume24hQuote,
              bid: ticker.bidPrice,
              ask: ticker.askPrice,
              spread: spread,
              updatedAt: Date.now(),
            })
          )
        );
      }

      // Bulk save in chunks of 500 to avoid query length limits
      for (let i = 0; i < toSave.length; i += 500) {
        await this.seRepo.save(toSave.slice(i, i + 500));
      }

      await Promise.allSettled(redisUpdates);

      this.logger.log(`✅ ${exchange} ticker: ${toSave.length} symbols updated`);

    } catch (err) {
      this.logger.error(`${exchange} ticker sync failed`, err);
    }
  }

  // ── CORE: sync depth for top symbols ─────────────────────
  private async syncExchangeDepth(
    exchange: Exchange,
    fetchFn: (symbol: string, mid: number) => Promise<any>,
  ) {
    try {
      console.log("deptt",)
      // Get top symbols by 24h volume (already have it from ticker sync)
      const rows = await this.seRepo.find({
        where: { exchange, isActive: true },
        relations: ['symbol'],
        order: { volume24hUsd: 'DESC' },
        take: DEPTH_SYMBOL_LIMIT,
      });

      // Fetch depth sequentially with 100ms gap to respect rate limits
      for (const row of rows) {
        if (!row.lastPrice) continue;
        const depth = await fetchFn(row.symbol.symbol, row.lastPrice);
        if (!depth) continue;

        row.depthBid2pct = depth.bidDepth2pct;
        row.depthAsk2pct = depth.askDepth2pct;
        await this.seRepo.save(row);

        await new Promise(r => setTimeout(r, 100)); // 100ms gap
      }

      this.logger.log(`✅ ${exchange} depth: ${rows.length} symbols updated`);

    } catch (err) {
      this.logger.error(`${exchange} depth sync failed`, err);
    }
  }

 

  // // ── ON-DEMAND: get exchange stats for a single symbol ─────
  // // Called by the API controller for /markets/:symbol/exchange-stats
  // async getExchangeStats(symbolStr: string) {
  //   const symbol = await this.symbolRepo.findOne({
  //     where: { base: symbolStr },
  //   });
  //   if (!symbol) return [];

  //   // Try Redis first (fast path)
  //   const exchanges = [Exchange.BINANCE, Exchange.MEXC, Exchange.OKX];
  //   const results = await Promise.all(
  //     exchanges.map(async ex => {
  //       const cached = await this.redis.get(
  //         `exchange:ticker:${ex}:${symbol.symbol}`
  //       );
  //       if (cached) return { exchange: ex, ...JSON.parse(cached) };

  //       // Redis miss — read from DB
  //       const row = await this.seRepo.findOne({
  //         where: { exchange: ex, symbol: { id: symbol.id } },
  //         relations: ['symbol'],
  //       });
  //       if (!row || !row.lastPrice) return null;

  //       return {
  //         exchange: ex,
  //         price: row.lastPrice,
  //         change24h: row.priceChange24h,
  //         high24h: row.high24h,
  //         low24h: row.low24h,
  //         volume24hBase: row.volume24hBase,
  //         volume24hUsd: row.volume24hUsd,
  //         bid: row.bidPrice,
  //         ask: row.askPrice,
  //         spread: row.spreadPct,
  //         depthBid2pct: row.depthBid2pct,
  //         depthAsk2pct: row.depthAsk2pct,
  //         updatedAt: row.updatedAt,
  //       };
  //     })
  //   );

  //   return results.filter(Boolean);
  // }
}

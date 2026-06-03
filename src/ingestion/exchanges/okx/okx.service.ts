// ============================================================
// okx.service.ts
//
// SSL 525 / ENOTFOUND = OKX is blocking your network via Cloudflare.
// This is a network-level block — no code fix resolves it.
// All methods return empty results gracefully so the app keeps running.
//
// checkConnectivity() runs once at startup.
// If OKX is unreachable → isAvailable=false → all methods no-op.
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { Exchange } from '@/common/enums/exchanges.enums';
import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { ExchangeTicker, OrderBookDepth } from '@/ingestion/symbols/exchange-market-data.interface';

const BASE    = 'https://www.okx.com/api/v5';
const TIMEOUT = 5_000;

@Injectable()
export class OkxService {
  private readonly logger    = new Logger(OkxService.name);
  private isAvailable        = true;   // set false on first network error
  private availabilityChecked = false;

  constructor(private readonly symbolsService: SymbolsService) {}

  // ── Pre-flight check — call once at startup ───────────────────
  async checkConnectivity(): Promise<boolean> {
    if (this.availabilityChecked) return this.isAvailable;
    this.availabilityChecked = true;

    try {
      // Lightweight endpoint — just checks if OKX REST is reachable
      await axios.get(`${BASE}/public/time`, { timeout: TIMEOUT });
      this.isAvailable = true;
      this.logger.log('✅ OKX REST API reachable');
    } catch (err: any) {
      this.isAvailable = false;
      const status = err?.response?.status ?? err?.status;
      const code   = err?.code;
      const msg    = err?.message ?? '';

      if (status === 525 || msg.includes('SSL handshake')) {
        this.logger.warn(
          `⚠️  OKX blocked (SSL 525) — Cloudflare is rejecting connections from your network/IP. ` +
          `OKX disabled. Use a VPN or a server in US/EU to access OKX.`
        );
      } else if (status === 403 || status === 407) {
        this.logger.warn(`⚠️  OKX blocked (HTTP ${status}) — OKX disabled.`);
      } else if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
        this.logger.warn(`⚠️  OKX unreachable (${code}) — OKX disabled.`);
      } else {
        this.logger.warn(`⚠️  OKX connectivity check failed (${status ?? code ?? msg.slice(0, 60)}) — OKX disabled.`);
      }
    }

    return this.isAvailable;
  }

  // ── Symbol sync ───────────────────────────────────────────────
  async fetchAndStoreSymbols(): Promise<void> {
    if (!await this.checkConnectivity()) return;

    try {
      const res = await axios.get(`${BASE}/public/instruments`, {
        params:  { instType: 'SPOT' },
        timeout: TIMEOUT,
      });

      const apiSymbols = (res.data?.data ?? [])
        .filter((i: any) => i.quoteCcy === 'USDT' && i.state === 'live')
        .map((i: any) => ({
          symbol: i.instId.replace('-', ''),
          base:   i.baseCcy,
          quote:  i.quoteCcy,
        }));

      await this.symbolsService.syncExchangeSymbols(Exchange.OKX, apiSymbols);
      this.logger.log(`✅ OKX: synced ${apiSymbols.length} symbols`);

    } catch (err: any) {
      this.handleError('fetchAndStoreSymbols', err);
    }
  }

  // ── Batch ticker ──────────────────────────────────────────────
  async fetchAllTickers(): Promise<ExchangeTicker[]> {
    if (!await this.checkConnectivity()) return [];

    try {
      const res = await axios.get(`${BASE}/market/tickers`, {
        params:  { instType: 'SPOT' },
        timeout: TIMEOUT,
      });

      return (res.data?.data ?? [])
        .filter((t: any) => t.instId.endsWith('-USDT'))
        .map((t: any) => {
          const last = parseFloat(t.last) || 0;
          const open = parseFloat(t.open24h) || last;
          return {
            symbol:         t.instId.replace('-', ''),
            lastPrice:      last,
            priceChange24h: open > 0 ? ((last - open) / open) * 100 : 0,
            high24h:        parseFloat(t.high24h)   || 0,
            low24h:         parseFloat(t.low24h)    || 0,
            volume24hBase:  parseFloat(t.vol24h)    || 0,
            volume24hQuote: parseFloat(t.volCcy24h) || 0,
            bidPrice:       parseFloat(t.bidPx)     || 0,
            askPrice:       parseFloat(t.askPx)     || 0,
          } as ExchangeTicker;
        });

    } catch (err: any) {
      this.handleError('fetchAllTickers', err);
      return [];
    }
  }

  // ── Order book depth ──────────────────────────────────────────
  async fetchDepth(symbol: string, midPrice: number): Promise<OrderBookDepth | null> {
    if (!await this.checkConnectivity()) return null;

    try {
      const instId = this.toInstId(symbol);
      const res    = await axios.get(`${BASE}/market/books`, {
        params:  { instId, sz: 100 },
        timeout: TIMEOUT,
      });

      const data = res.data?.data?.[0];
      if (!data) return null;

      const threshold = midPrice * 0.02;
      let bidDepth = 0, askDepth = 0;

      for (const [price, qty] of data.bids as [string, string][]) {
        const p = parseFloat(price);
        if (midPrice - p > threshold) break;
        bidDepth += p * parseFloat(qty);
      }
      for (const [price, qty] of data.asks as [string, string][]) {
        const p = parseFloat(price);
        if (p - midPrice > threshold) break;
        askDepth += p * parseFloat(qty);
      }

      return { symbol, bidDepth2pct: bidDepth, askDepth2pct: askDepth };

    } catch (err: any) {
      this.handleError(`fetchDepth(${symbol})`, err);
      return null;
    }
  }

  // ── Historical candles ────────────────────────────────────────
  async fetch1mCandles(symbol: string, startTime?: Date): Promise<any[]> {
    if (!await this.checkConnectivity()) return [];

    const candles: any[] = [];
    const instId  = this.toInstId(symbol);
    let   after   = Date.now();
    const before  = startTime ? startTime.getTime() : 0;

    while (after > before) {
      try {
        const res  = await axios.get(`${BASE}/market/history-candles`, {
          params:  { instId, bar: '1m', limit: 300, after },
          timeout: TIMEOUT,
        });
        const data = res.data?.data ?? [];
        if (!data.length) break;

        for (const d of data) {
          const ts = Number(d[0]);
          if (ts < before) break;
          candles.push({ openTime: ts, open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] });
        }

        after = Number(data[data.length - 1][0]) - 1;
        await new Promise(r => setTimeout(r, 200));

      } catch (err: any) {
        this.handleError(`fetch1mCandles(${symbol})`, err);
        break;
      }
    }

    return candles.reverse();
  }

  async fetchFirstCandleTime(symbol: string): Promise<Date> {
    if (!await this.checkConnectivity()) return new Date();
    try {
      const instId = this.toInstId(symbol);
      const res    = await axios.get(`${BASE}/market/history-candles`, {
        params:  { instId, bar: '1m', limit: 1, after: 1 },
        timeout: TIMEOUT,
      });
      const data = res.data?.data ?? [];
      return data.length ? new Date(Number(data[0][0])) : new Date();
    } catch {
      return new Date();
    }
  }

  async getPrice(symbol: string): Promise<number> {
    if (!await this.checkConnectivity()) return 0;
    try {
      const instId = this.toInstId(symbol);
      const res    = await axios.get(`${BASE}/market/ticker`, {
        params:  { instId },
        timeout: TIMEOUT,
      });
      return parseFloat(res.data?.data?.[0]?.last ?? '0');
    } catch {
      return 0;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private toInstId(symbol: string): string {
    if (symbol.includes('-')) return symbol;
    for (const quote of ['USDT', 'USDC', 'BTC', 'ETH']) {
      if (symbol.endsWith(quote)) return `${symbol.slice(0, -quote.length)}-${quote}`;
    }
    return symbol;
  }

  private handleError(method: string, err: any) {
    const status = err?.response?.status ?? err?.status;
    const code   = err?.code;
    const msg    = err?.message ?? String(err);

    // OKX is network-blocked — disable silently, no giant object dump
    if (
      status === 525 || status === 403 || status === 407 ||
      code === 'ENOTFOUND' || code === 'ECONNREFUSED' ||
      msg.includes('525') || msg.includes('SSL handshake')
    ) {
      this.isAvailable = false;
      this.logger.warn(
        `OKX ${method}: blocked (${status ?? code}) — OKX disabled for this session. ` +
        `Use a VPN or server in a supported region to enable OKX data.`
      );
      return;
    }

    // All other errors: log message only, never the full axios object
    this.logger.error(`OKX ${method} failed (${status ?? code}): ${msg}`);
  }
}
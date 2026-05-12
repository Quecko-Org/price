// ============================================================
// okx.service.ts
// REST API calls for OKX: symbol sync + first candle time.
// ============================================================
import { Exchange } from '@/common/enums/exchanges.enums';
import { STABLES } from '@/ingestion/onchain/common/common-tokens';
import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ExchangeTicker, OrderBookDepth } from '../exchange-market-data.interface';

const BASE = 'https://www.okx.com/api/v5';

@Injectable()
export class OkxService {
  private readonly logger = new Logger(OkxService.name);
  constructor(private readonly symbolsService: SymbolsService) { }

  // Fetch all USDT spot pairs
  async fetchAndStoreSymbols() {
    try {
        const allowedQuote = new Set(STABLES);
      const res  = await axios.get(`${BASE}/public/instruments`, {
        params: { instType: 'SPOT' },
      });
      const data = res.data?.data ?? [];
 
    const symbolsData=data
        .filter((i: any) => i.state === 'live' && allowedQuote.has(i.instId.split('-')[1]) )
        .map((i: any) => ({
          symbol: i.instId,              // BTC-USDT (OKX native format)
          base:   i.baseCcy,            // BTC
          quote:  i.quoteCcy,           // USDT
        }));
        await this.symbolsService.syncExchangeSymbols(
            Exchange.OKX,
            symbolsData,
          );
    } catch (err) {
      this.logger.error('OKX fetchSymbols failed', err);
      return [];
    }
  }
 
  // Fetch earliest available 1m candle timestamp
  async fetchFirstCandleTime(symbol: string): Promise<number> {
    try {
      const res = await axios.get(`${BASE}/market/history-candles`, {
        params: {
          instId: symbol,
          bar:    '1m',
          limit:  1,
          after:  1,  // earliest possible
        },
      });
      const data = res.data?.data ?? [];
      return data.length ? Number(data[0][0]) : Date.now();
    } catch (err) {
      this.logger.error(`OKX fetchFirstCandleTime ${symbol} failed`, err);
      return Date.now();
    }
  }

  // Fetch historical 1m candles for backfill
  async fetch1mCandles(
    symbol:    string,
    startTime: Date,
    endTime?:  Date,
  ): Promise<any[]> {
    const candles: any[] = [];
    let after = endTime ? endTime.getTime() : Date.now();
    const before = startTime.getTime();

    while (after > before) {
      try {
        const res  = await axios.get(`${BASE}/market/history-candles`, {
          params: { instId: symbol, bar: '1m', limit: 300, after },
        });
        const data = res.data?.data ?? [];
        if (!data.length) break;

        for (const d of data) {
          const ts = Number(d[0]);
          if (ts < before) break;
          candles.push({
            openTime: ts,
            open:     Number(d[1]),
            high:     Number(d[2]),
            low:      Number(d[3]),
            close:    Number(d[4]),
            volume:   Number(d[5]),
          });
        }

        after = Number(data[data.length - 1][0]) - 1;
        await new Promise(r => setTimeout(r, 200)); // rate limit

      } catch (err) {
        this.logger.error(`OKX fetch1mCandles ${symbol} failed`, err);
        break;
      }
    }

    return candles.reverse(); // oldest first
  }



   // ── OKX ticker adapter ────────────────────────────────────
   async fetchAllTickers(): Promise<ExchangeTicker[]> {
    try {
      const res = await axios.get(`${BASE}/market/tickers`, {
        params: { instType: 'SPOT' },
      });
      // console.log("res",res)

      return (res.data?.data ?? [])
        .map((t: any) => {
          const last  = parseFloat(t.last)  || 0;
          const open  = parseFloat(t.open24h) || last; // 24h open price
 
          return {
            symbol:         t.instId.replace('-', ''), // BTC-USDT → BTCUSDT
            lastPrice:      last,
            priceChange24h: open > 0 ? ((last - open) / open) * 100 : 0,
            high24h:        parseFloat(t.high24h)  || 0,
            low24h:         parseFloat(t.low24h)   || 0,
            volume24hBase:  parseFloat(t.vol24h)   || 0, // base token volume
            volume24hQuote: parseFloat(t.volCcy24h) || 0, // USDT volume
            bidPrice:       parseFloat(t.bidPx)    || 0,
            askPrice:       parseFloat(t.askPx)    || 0,
          } as ExchangeTicker;
        });
    } catch (err) {
      this.logger.error('OKX fetchAllTickers failed', err);
      return [];
    }
  }
 
  // ── Order book depth within 2% of mid price ──────────────────
  // OKX instId format: BTC-USDT (with hyphen)
  async fetchDepth(symbol: string, midPrice: number): Promise<OrderBookDepth | null> {
    try {
      // Convert BTCUSDT → BTC-USDT for OKX API
      const res = await axios.get(`${BASE}/market/books`, {
        params: { instId:symbol, sz: 100 }, // top 100 levels
      });

      const data = res.data?.data?.[0];
      if (!data) return null;
 
      const threshold = midPrice * 0.02; // 2% band
 
      let bidDepth = 0;
      for (const [price, qty] of data.bids as [string, string][]) {
        const p = parseFloat(price);
        if (midPrice - p > threshold) break;
        bidDepth += p * parseFloat(qty);
      }
 
      let askDepth = 0;
      for (const [price, qty] of data.asks as [string, string][]) {
        const p = parseFloat(price);
        if (p - midPrice > threshold) break;
        askDepth += p * parseFloat(qty);
      }
 
      return { symbol, bidDepth2pct: bidDepth, askDepth2pct: askDepth };
 
    } catch (err) {
      this.logger.error(`OKX fetchDepth ${symbol} failed`, err);
      return null;
    }
  }
}
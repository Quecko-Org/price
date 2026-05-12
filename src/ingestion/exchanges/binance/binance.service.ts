import { Exchange } from '@/common/enums/exchanges.enums';
import { ExchangeTicker, OrderBookDepth } from '@/ingestion/exchanges/exchange-market-data.interface';
import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class BinanceService {
  constructor(private readonly symbolsService: SymbolsService) { }

  // GET /api/v3/exchangeInfo Know which symbols exist



  private readonly logger = new Logger(BinanceService.name);
  private readonly baseUrl = 'https://api.binance.com/api/v3';

  async getPrice(symbol: string): Promise<number> {
    try {
      const response = await axios.get(`${this.baseUrl}/ticker/price`, { params: { symbol } });
      return parseFloat(response.data.price);
    } catch (error) {
      this.logger.error(`Error fetching price for ${symbol}: ${error}`);
      throw error;
    }
  }


  async fetchAndStoreSymbols() {
    const res = await axios.get(`${this.baseUrl}/exchangeInfo`);
  
    const apiSymbols = res.data.symbols
      .filter((s: any) => s.status === 'TRADING')
      .map((s: any) => ({
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
      }));
      console.log("binance symbol data",apiSymbols[0],apiSymbols.length)
    await this.symbolsService.syncExchangeSymbols(
      Exchange.BINANCE,
      apiSymbols,
    );
  }



  async fetch1mCandles(symbol: string, startTime?: number) {
    const res = await axios.get(`${this.baseUrl}/klines`, {
      params: {
        symbol,
        interval: '1m',
        startTime,
        limit: 1000,
      },
    });

    return res.data.map(k => ({
      openTime: k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }));
  }


  async fetchFirstCandleTime(symbol: string): Promise<Date> {
    const res = await axios.get(`${this.baseUrl}/klines`, {
      params: {
        symbol,
        interval: '1m',
        startTime: 0,
        limit: 1,
      },
    });

    return new Date(res.data[0][0]); // openTime
  }



  async getKlines(symbol: string, interval = '1m', limit = 100) {
    const res = await axios.get(`${this.baseUrl}/klines`, {
      params: { symbol, interval, limit },
    });
    return res.data.map((k: any) => ({
      openTime:  new Date(k[0]),
      open:      parseFloat(k[1]),
      high:      parseFloat(k[2]),
      low:       parseFloat(k[3]),
      close:     parseFloat(k[4]),
      volume:    parseFloat(k[5]),
      closeTime: new Date(k[6]),
    }));
  }

    // ── NEW: BATCH TICKER (all USDT symbols in one call) ─────
  //
  // Binance /ticker/24hr returns ALL symbols in ~150ms.
  // Way faster than individual calls per symbol.
  // Returns price, 24h stats, bid/ask for every symbol.
  async fetchAllTickers(): Promise<ExchangeTicker[]> {
    try {
      const res  = await axios.get(`${this.baseUrl}/ticker/24hr`);
      const data = res.data as any[];
//  console.log("h",data)
      return data
        // .filter(t => t.symbol.endsWith('USDT'))
        .map(t => ({
          symbol:         t.symbol,
          lastPrice:      parseFloat(t.lastPrice),
          priceChange24h: parseFloat(t.priceChangePercent),
          high24h:        parseFloat(t.highPrice),
          low24h:         parseFloat(t.lowPrice),
          volume24hBase:  parseFloat(t.volume),      // base token volume
          volume24hQuote: parseFloat(t.quoteVolume), // USDT volume
          bidPrice:       parseFloat(t.bidPrice),
          askPrice:       parseFloat(t.askPrice),
        }));
    } catch (err) {
      this.logger.error('Binance fetchAllTickers failed', err);
      return [];
    }
  }

   // ── NEW: ORDER BOOK DEPTH ─────────────────────────────────
  //
  // Fetches top N levels of the order book and sums USD value
  // of bids/asks within 2% of the mid price.
  // Only call this for liquid symbols — rate limit is 1200/min.
  async fetchDepth(symbol: string, midPrice: number): Promise<OrderBookDepth | null> {
    try {
      const res  = await axios.get(`${this.baseUrl}/depth`, {
        params: { symbol, limit: 100 }, // top 100 levels
      });
 
      const bids: [string, string][] = res.data.bids;
      const asks: [string, string][] = res.data.asks;
 
      const threshold = midPrice * 0.02; // 2% band
 
      let bidDepth = 0;
      for (const [price, qty] of bids) {
        const p = parseFloat(price);
        if (midPrice - p > threshold) break; // outside 2% band
        bidDepth += p * parseFloat(qty);     // USD value
      }
 
      let askDepth = 0;
      for (const [price, qty] of asks) {
        const p = parseFloat(price);
        if (p - midPrice > threshold) break;
        askDepth += p * parseFloat(qty);
      }
 
      return { symbol, bidDepth2pct: bidDepth, askDepth2pct: askDepth };
    } catch (err) {
      this.logger.error(`Binance fetchDepth ${symbol} failed`, err);
      return null;
    }
  }
 

}

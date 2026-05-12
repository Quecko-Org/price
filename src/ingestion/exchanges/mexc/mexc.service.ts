import { Exchange } from '@/common/enums/exchanges.enums';
import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ExchangeTicker, OrderBookDepth } from '@/ingestion/exchanges/exchange-market-data.interface';


@Injectable()
export class MexcService {
  constructor
    (
      private readonly symbolsService: SymbolsService,
      private readonly httpService: HttpService

    ) { }

  // GET /api/v3/exchangeInfo Know which symbols exist



  private readonly logger = new Logger(MexcService.name);
  private readonly baseUrl = 'https://api.mexc.com/api/v3';

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
    let apiSymbols = res.data.symbols
      .filter(s => s.status == 1) // online offline
      .map(s => ({
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        // status: s.status
      }));
      console.log("mexc symbol data",apiSymbols[0],apiSymbols.length)
     

    await this.symbolsService.syncExchangeSymbols(Exchange.MEXC, apiSymbols);

  }


  async fetch1mCandles(symbol: string) {
    const res = await axios.get(`${this.baseUrl}/klines`, {
      params: {
        symbol,
        interval: '1m',
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

  // async fetchFirstCandleTime(symbol: string): Promise<Date> {
  //   const candles = await this.fetch1mCandles(symbol, undefined, 1);
  //   return new Date(candles[0].openTime);
  // }

 

  async getKlines(symbol: string, interval = '1m', limit = 100) {
    const response = await axios.get(`${this.baseUrl}/klines`, {
      params: { symbol, interval, limit },
    });
    return response.data.map((k) => ({
      openTime: new Date(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: new Date(k[6]),
    }));
  }





// ── NEW: BATCH TICKER ─────────────────────────────────────
  //
  // MEXC /ticker/24hr returns all symbols.
  // Note: MEXC doesn't include bid/ask in ticker — we use bookTicker.
  async fetchAllTickers(): Promise<ExchangeTicker[]> {
    try {
      const [tickerRes, bookRes] = await Promise.all([
        axios.get(`${this.baseUrl}/ticker/24hr`),
        axios.get(`${this.baseUrl}/ticker/bookTicker`),
      ]);
 
      // Build bid/ask map from bookTicker
      const bookMap = new Map<string, { bid: number; ask: number }>();
      for (const b of (bookRes.data as any[])) {
        bookMap.set(b.symbol, {
          bid: parseFloat(b.bidPrice),
          ask: parseFloat(b.askPrice),
        });
      }
 
      return (tickerRes.data as any[])
        // .filter(t => t.symbol.endsWith('USDT'))
        .map(t => {
          const book = bookMap.get(t.symbol);
          return {
            symbol:         t.symbol,
            lastPrice:      parseFloat(t.lastPrice),
            priceChange24h: parseFloat(t.priceChangePercent),
            high24h:        parseFloat(t.highPrice),
            low24h:         parseFloat(t.lowPrice),
            volume24hBase:  parseFloat(t.volume),
            volume24hQuote: parseFloat(t.quoteVolume),
            bidPrice:       book?.bid ?? parseFloat(t.lastPrice),
            askPrice:       book?.ask ?? parseFloat(t.lastPrice),
          };
        });
    } catch (err) {
      this.logger.error('MEXC fetchAllTickers failed', err);
      return [];
    }
  }
 
  // ── NEW: ORDER BOOK DEPTH ─────────────────────────────────
  async fetchDepth(symbol: string, midPrice: number): Promise<OrderBookDepth | null> {
    try {
      const res  = await axios.get(`${this.baseUrl}/depth`, {
        params: { symbol, limit: 100 },
      });
 
      const threshold = midPrice * 0.02;
 
      let bidDepth = 0;
      for (const [price, qty] of res.data.bids as [string, string][]) {
        const p = parseFloat(price);
        if (midPrice - p > threshold) break;
        bidDepth += p * parseFloat(qty);
      }
 
      let askDepth = 0;
      for (const [price, qty] of res.data.asks as [string, string][]) {
        const p = parseFloat(price);
        if (p - midPrice > threshold) break;
        askDepth += p * parseFloat(qty);
      }
 
      return { symbol, bidDepth2pct: bidDepth, askDepth2pct: askDepth };
    } catch (err) {
      this.logger.error(`MEXC fetchDepth ${symbol} failed`, err);
      return null;
    }
  }

  




















  async fetchFirstCandleTimes(
    symbol: string,
    interval: any = '1d',
  ): Promise<any> {
    this.logger.log(`🔍 Searching for first listing candle of ${symbol}...`);

    try {
      // Step 1: Try to get any data to verify symbol exists
      const initialCandle = await this.getFirstCandleFromTimestamp(
        symbol,
        interval,
        1230768000000, // 2009-01-01
      );
      console.log("initialCandle", initialCandle)
      if (!initialCandle) {
        // Symbol might be very new, try recent timestamp
        const recentCandle = await this.getFirstCandleFromTimestamp(
          symbol,
          interval,
          Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year ago
        );
        console.log("recentCandle", recentCandle)

        if (!recentCandle) {
          return {
            success: false,
            symbol,
            interval,
            error: 'Symbol not found or has no trading data',
          };
        }
      }
      console.log("aaaasdfghjk")

      // Step 2: Use binary search to find the absolute first candle
      const firstCandle = await this.binarySearchFirstCandle(symbol, interval);
      console.log("firstCandle", firstCandle)

      if (firstCandle) {
        this.logger.log(`✅ Found first listing candle for ${symbol} at ${firstCandle.firstCandleTime}`);
        return firstCandle;
      }

      return {
        success: false,
        symbol,
        interval,
        error: 'Could not determine first listing time',
      };
    } catch (error) {
      this.logger.error(`Error finding first candle: ${error.message}`);
      return {
        success: false,
        symbol,
        interval,
        error: error.message,
      };
    }
  }

  /**
   * Binary search to find the earliest candle
   */
  private async binarySearchFirstCandle(
    symbol: string,
    interval: string = '1d',
  ): Promise<any> {
    const now = Date.now();
    let left = 1230768000000; // 2009-01-01
    let right = now;
    let earliestCandle: any | null = null;

    this.logger.debug(`Starting binary search between ${new Date(left).toISOString()} and ${new Date(right).toISOString()}`);

    let iterations = 0;
    const maxIterations = 30; // Prevent infinite loops

    while (left <= right && iterations < maxIterations) {
      iterations++;
      const mid = Math.floor((left + right) / 2);

      this.logger.debug(`Iteration ${iterations}: Checking timestamp ${new Date(mid).toISOString()}`);

      const candle = await this.getFirstCandleFromTimestamp(symbol, interval, mid);

      if (candle) {
        // Found data at this timestamp, search earlier
        earliestCandle = candle;
        right = candle.firstCandleTimestamp - 1;
        this.logger.debug(`Found candle at ${candle.firstCandleTime}, searching earlier...`);
      } else {
        // No data at this timestamp, search later
        left = mid + 1;
        this.logger.debug(`No candle found, searching later...`);
      }

      // Add small delay to avoid rate limiting
      await this.sleep(100);
    }

    return earliestCandle;
  }

  /**
   * Get first candle from a specific timestamp
   */
  private async getFirstCandleFromTimestamp(
    symbol: string,
    interval: string,
    startTime: number,
  ): Promise<any | null> {
    try {
      console.log("startTime", startTime)

      const response = await axios.get(`${this.baseUrl}/klines`, {
        params: {
          symbol,
          interval: '1m',
          startTime: 1727481600000,
          limit: 1000,
        },
      });
      // console.log("ddd",res)
      const data = response.data;
      const candle = data[0];

      const firstCandleTime = new Date(candle[0]);

      // console.log("responseresponse", firstCandleTime, data.length, candle[0])
      process.exit();
      // const data = response.data;

      if (data && Array.isArray(data) && data.length > 0) {
        const candle = data[0];
        const firstCandleTime = new Date(candle[0]);

        return {
          success: true,
          symbol: symbol.toUpperCase(),
          interval,
          firstCandleTime: firstCandleTime.toISOString(),
          firstCandleTimestamp: candle[0],
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5],
          closeTime: candle[6],
          quoteVolume: candle[7],
        };
      }

      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        this.logger.warn('Rate limited, waiting...');
        await this.sleep(2000);
        return this.getFirstCandleFromTimestamp(symbol, interval, startTime);
      }

      // Symbol doesn't exist or no data
      return null;
    }
  }

  private sleeps(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }












  async fetchFirstCandleTime(symbol: string): Promise<string> {
    this.logger.log(`Finding first listing time for ${symbol}...`);

    const dailyTime = await this.binarySearch(symbol, '1d', 1230768000000, Date.now());

    if (!dailyTime) {
      throw new Error(`No trading data found for ${symbol}`);
    }

    const twoDays = 2 * 24 * 60 * 60 * 1000;
    const hourlyTime = await this.binarySearch(
      symbol,
      '60m',
      dailyTime - twoDays,
      dailyTime + twoDays,
    );

    const firstTime = new Date(hourlyTime || dailyTime).toISOString();
    this.logger.log(`✅ First listing time: ${firstTime}`);

    return firstTime;
  }

  private async binarySearch(
    symbol: string,
    interval: string,
    left: number,
    right: number,
  ): Promise<number | null> {
    let earliest: number | null = null;
    let iterations = 0;
    console.log("cccc", left <= right && iterations < 30)
    while (left <= right && iterations < 30) {
      iterations++;
      const mid = Math.floor((left + right) / 2);
      const candleTime = await this.checkCandleExists(symbol, interval, mid);

      if (candleTime) {
        earliest = candleTime;
        right = candleTime - 1;
      } else {
        left = mid + 1;
      }

      await this.sleep(100);
    }

    return earliest;
  }

  private async checkCandleExists(
    symbol: string,
    interval: string,
    startTime: number,
  ): Promise<number | null> {
    try {
      console.log("sssss", new Date(startTime), startTime)
      const { data } = await axios.get(`${this.baseUrl}/klines`, {
        params: { symbol: symbol.toUpperCase(), interval, startTime, limit: 1 },
        timeout: 10000,
      });
      console.log("ree", data[0]?.[0])
      return data?.[0]?.[0] || null;
    } catch (error) {
      if (error.response?.status === 429) {
        await this.sleep(2000);
        return this.checkCandleExists(symbol, interval, startTime);
      }
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}

import { Exchange } from '@/common/enums/exchanges.enums';
import { SymbolsService } from '@/ingestion/symbols/symbol.service';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';


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

  async s(symbol: string): Promise<Date> {

    const response = await axios.get(
      'https://www.okx.com/api/v5/market/history-candles',
      {
        params: {
          after: "1564893002000",
          instId: 'BTC-USDT',
          bar: '1m',
          limit: 2,
        },
      },
    );

    const candles = response.data?.data ?? [];
    console.log("ccc", candles)
    // if (!candles.length) 

    // OKX returns newest → oldest
    const firstCandle = candles[candles.length - 1];
    // console.log("ccc",firstCandle)

    return firstCandle[0];
    //   let low = Date.parse("2018-01-01T00:00:00Z"); // very early timestamp
    //   let high = Date.now();
    //   let found;

    //   while (low <= high) {
    //     const mid = Math.floor((low + high) / 2); // ✅ use Math.floor, not >>

    //     const { data } = await axios.get(`${this.baseUrl}/klines`, {
    //       params: { symbol, interval: "1m", startTime: mid, limit: 1 }
    //     });

    //     if (data.length) {
    //       console.log("mex service fetchFirstCandleTime ",mid,low,high,data)

    //       found = data[0];
    //       high = mid - 1; // go earlier
    //     } else {
    //       low = mid + 1;  // go later
    //     }


    //     // small delay to avoid rate limits
    //     await new Promise(r => setTimeout(r, 50));
    //   }

    //   if (!found) throw new Error("No candle found for this symbol.");
    // return new Date()
    // const res = await axios.get(`${this.baseUrl}/klines`, {
    //   params: {
    //     symbol,
    //     interval: '1m',
    //     startTime: 1517731885,
    //     limit: 1,
    //   },
    // });

    // console.log("mex service fetchFirstCandleTime ",res.data)
    //   return new Date(res.data[0][0]); // openTime
  }


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

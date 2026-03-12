import { Exchange } from '@/common/enums/exchanges.enums';
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
}

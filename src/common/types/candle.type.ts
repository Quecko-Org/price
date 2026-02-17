import { Exchange } from "../enums/exchanges.enums";


  type BaseExchangeCandle = {
    exchange: Exchange;
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  
  // Regular candle
  export type ExchangeCandle = BaseExchangeCandle;
  export interface LiveBufferEntry {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    sources: { exchange: Exchange; price: number; volume: number }[];
  }
  
  export type ExchangeLiveCandle = BaseExchangeCandle & {
    isFinal: boolean;
  };
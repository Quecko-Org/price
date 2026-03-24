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

export type ExchangeCandle = BaseExchangeCandle;

export type ExchangeLiveCandle = BaseExchangeCandle & {
  isFinal?: boolean;
  quote: string;

};

// export interface LiveBufferEntry {
//   openTime: number;
//   open: number;
//   high: number;
//   low: number;
//   close: number;
//   volume: number;
//   weightedPriceSum: number;
//   weightSum: number;
//   exchanges: Map<Exchange, { price: number; volume: number }>;
  
// }
export type LiveBufferEntry = {
  openTime: number;
  exchanges: Map<Exchange, ExchangeCandle>;
};
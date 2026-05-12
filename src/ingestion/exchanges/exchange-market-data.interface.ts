// ============================================================
// exchange-market-data.interface.ts
// Shared contract for fetching per-exchange market data.
// Each exchange implements this — Binance, MEXC, OKX etc.
// ============================================================

export interface ExchangeTicker {
    symbol:         string;   // exchange format: BTCUSDT
    lastPrice:      number;   // last traded price (USD if quote=USDT, raw otherwise)
    priceChange24h: number;   // % change over 24h
    high24h:        number;
    low24h:         number;
    volume24hBase:  number;   // base token volume (BTC)
    volume24hQuote: number;   // quote volume (USDT)
    bidPrice:       number;
    askPrice:       number;
  }
  
  export interface OrderBookDepth {
    symbol:       string;
    bidDepth2pct: number;   // USD value of bids within 2% of mid
    askDepth2pct: number;   // USD value of asks within 2% of mid
  }
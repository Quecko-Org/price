import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import WebSocket from "ws";
import { Exchange } from "@/common/enums/exchanges.enums";
import { AggregationService } from "@/aggregation/aggregation.service";

@Injectable()
export class BinanceWebSocket {

  private readonly logger = new Logger(BinanceWebSocket.name);

  private sockets: WebSocket[] = [];

  constructor(
    @Inject(forwardRef(() => AggregationService))
    private readonly aggregationService: AggregationService
  ) {}

  connect(
    symbols: string[],
    symbolMarketMap: Record<string, number>,
    symbolMetaMap: Record<string, { base: string; quote: string }>
  ) {

    const streams = symbols
      .map(s => `${s.toLowerCase()}@kline_1m`)
      .join("/");

    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    const ws = new WebSocket(url);

    this.sockets.push(ws);

    ws.on("open", () => {
      this.logger.log(`Binance WS connected (${symbols.length})`);
    });

    ws.on("message", msg => {

      const data = JSON.parse(msg.toString());

      if (!data?.data?.k) return;

      const k = data.data.k;

      const key = `${Exchange.BINANCE}:${k.s}`;

      const marketId = symbolMarketMap[key];
      if (!marketId) return;

      const meta = symbolMetaMap[key];
      if (!meta) return;

      this.aggregationService.handleLiveCandle(
        marketId,
        Exchange.BINANCE,
        {
          exchange: Exchange.BINANCE,
          openTime: k.t,
          quote: meta.quote,
          open: +k.o,
          high: +k.h,
          low: +k.l,
          close: +k.c,
          volume: +k.v,
          isFinal: k.x,
        }
      );
    });

    ws.on("close", () => {
      this.logger.warn(`Binance WS closed (${symbols.length})`);
      setTimeout(() => {
        this.connect(symbols, symbolMarketMap, symbolMetaMap);
      }, 3000);
    });

    ws.on("error", err => {
      this.logger.error("Binance WS error", err);
      ws.close();
    });
  }
}




// import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
// import WebSocket from 'ws';
// import { Exchange } from '@/common/enums/exchanges.enums';
// import { AggregationService } from '@/aggregation/aggregation.service';

// @Injectable()
// export class BinanceWebSocket {
//   private readonly logger = new Logger(BinanceWebSocket.name);
//   private ws?: WebSocket;
//   private symbols: string[] = [];
//   private reconnectTimeout?: NodeJS.Timeout;
//   private symbolMarketMap: Record<string, number> = {};
//   private symbolMetaMap:  Record<string, { base: string; quote: string }> = {};

//   //   Because string symbols are slow and inconsistent across exchanges.
//   //   Example problem

//   // Binance: BTCUSDT

//   // Coinbase: BTC-USD

//   // Kraken: XBTUSD

//   // Internally, you want one stable ID:
//   // const symbolIdMap: Record<string, number> = {
//   //   BTCUSDT: 1,
//   //   ETHUSDT: 2,
//   //   BNBUSDT: 3,
//   // };


//   constructor(
//       @Inject(forwardRef(() => AggregationService))
//     private readonly aggregationService: AggregationService,
//   ) { }

//   connect(symbols: string[], 
//     symbolMarketMap: Record<string, number>,  
//     symbolMetaMap: Record<string, { base: string; quote: string }>
//     ) {
//       console.log("binance",symbols)
//     this.symbols = symbols;
//     this.symbolMarketMap = symbolMarketMap;
//     this.symbolMetaMap = symbolMetaMap;

//     const streams = symbols.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
//     const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
 
//     this.ws = new WebSocket(url);

//     this.ws.on('open', () => this.logger.log('Binance WS connected'));

//     this.ws.on('message', msg => {
//       const data = JSON.parse(msg.toString());
//       if (!data?.data?.k) return;

//       const k = data.data.k;
//       const key = `${Exchange.BINANCE}:${k.s}`;
//       const marketId = this.symbolMarketMap[key];
//       if (!marketId) return;

//       const meta = this.symbolMetaMap[key];
//       if (!meta) return;
//       this.aggregationService.handleLiveCandle(marketId, Exchange.BINANCE, {
//         exchange: Exchange.BINANCE,
//         openTime: k.t,
//         quote: meta.quote,  
//         open: +k.o,
//         high: +k.h,
//         low: +k.l,
//         close: +k.c,
//         volume: +k.v,
//         isFinal: k.x,
//       });
//     });

//     this.ws.on('close', () => {
//       this.logger.warn('Binance WS closed, reconnecting...');
//       this.reconnect();
//     });

//     this.ws.on('error', err => {
//       this.logger.error('Binance WS error', err);
//       this.ws?.close();
//     });
//   }

//   private reconnect() {
//     if (this.reconnectTimeout) return;
//     this.reconnectTimeout = setTimeout(() => {
//       this.reconnectTimeout = undefined;
//       this.connect(this.symbols, this.symbolMarketMap,this.symbolMetaMap);
//     }, 3_000);
//   }


// }

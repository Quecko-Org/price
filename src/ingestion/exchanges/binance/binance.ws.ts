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
  
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;
  
    let retry = 1;
    let isAlive = true;
    let pingInterval: NodeJS.Timeout;
    let reconnectTimer: NodeJS.Timeout;
  
    const ws = new WebSocket(url);
  
    this.sockets.push(ws);
  
    ws.on("open", () => {
      retry = 1;
      this.logger.log(`✅ Binance WS connected`);
  
      // ❤️ heartbeat
      pingInterval = setInterval(() => {
        if (!isAlive) {
          this.logger.warn('💀 No pong → reconnect');
          ws.terminate();
          return;
        }
  
        isAlive = false;
        ws.ping();
      }, 30000);
  
      // ⏱️ reconnect before 24h
      reconnectTimer = setTimeout(() => {
        this.logger.warn('♻️ Forced reconnect before 24h');
        ws.close();
      }, 23 * 60 * 60 * 1000);
    });
  
    ws.on("pong", () => {
      isAlive = true;
    });
  
    ws.on("message", msg => {
      try {
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
  
      } catch (err) {
        this.logger.error('Parse error', err);
      }
    });
  
    ws.on("close", () => {
      this.logger.warn(`❌ Binance WS closed`);
  
      clearInterval(pingInterval);
      clearTimeout(reconnectTimer);
  
      const delay = Math.min(30000, retry * 3000);
  
      setTimeout(() => {
        retry++;
        this.connect(symbols, symbolMarketMap, symbolMetaMap);
      }, delay);
    });
  
    ws.on("error", err => {
      this.logger.error("❌ Binance WS error", err);
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

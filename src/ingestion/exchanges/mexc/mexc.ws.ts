import WebSocket from 'ws';
import { Injectable, Logger } from '@nestjs/common';
import { Exchange } from '@/common/enums/exchanges.enums';
import { AggregationService } from '@/aggregation/aggregation.service';

// Install: npm install @frank1957/exchange-pb
// This package provides the protobuf definitions for MEXC
import { mexc } from '@frank1957/exchange-pb';

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
}

@Injectable()
export class MexcWebSocket {
  private readonly logger = new Logger(MexcWebSocket.name);
  private ws?: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private symbolMarketMap: Record<string, number> = {};
  private symbolMetaMap:  Record<string, { base: string; quote: string }> = {};

  private symbols: string[] = [];
  private lastCandle: Record<string, Candle> = {};
  private toNumber(value?: string | null): number {
    return value ? Number(value) : 0;
  }
  constructor(
    // @Inject(forwardRef(() => AggregationService))
    private readonly aggregationService: AggregationService,
  ) {}
  private safeSend(payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
  connect(symbols: string[], symbolMarketMap: Record<string, number>,
    symbolMetaMap: Record<string, { base: string; quote: string }>
    ) {
      console.log("mexc",symbols)

    this.symbols = symbols;
    this.symbolMarketMap = symbolMarketMap;
    this.symbolMetaMap = symbolMetaMap;

    this.ws = new WebSocket('wss://wbs-api.mexc.com/ws');
  
    this.ws.on('open', () => {
      this.logger.log('Connected to MEXC Spot WebSocket');
  
      const params = symbols.map(
        s => `spot@public.kline.v3.api.pb@${s}@Min1`
      );
  
      this.safeSend({
        method: 'SUBSCRIPTION',
        params,
      });
  
      /** keep connection alive */
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ method: 'PING' }));
        }
      }, 20_000);
    });
  
    this.ws.on('message', (data: Buffer) => {
      try {
  
        /** JSON responses (PONG, confirmations) */
        if (data[0] === 0x7b) {
  
          const json = JSON.parse(data.toString());
  
          if (json?.msg === 'PONG') return;
  
          if (json?.msg?.includes('spot@public.kline')) {
            this.logger.log(`Subscribed: ${json.msg}`);
          }
  
          return;
        }
  
        /** protobuf message */
        const wrapper = mexc.PushDataV3ApiWrapper.decode(data);
  
        const kline = wrapper.publicSpotKline;
        if (!kline) return;
  
        const symbol = wrapper.symbol;
  
        const key = `${Exchange.MEXC}:${symbol}`;
        const marketId = this.symbolMarketMap[key];
  
        if (!marketId) return;
        const meta = this.symbolMetaMap[key];
        if (!meta) return;
        const openTime = Number(kline.windowStart) * 1000;
  
        this.aggregationService.handleLiveCandle(
          marketId,
          Exchange.MEXC,
          {
            exchange: Exchange.MEXC,
            openTime,
            quote: meta.quote,  
            open: this.toNumber(kline.openingPrice),
            high: this.toNumber(kline.highestPrice),
            low: this.toNumber(kline.lowestPrice),
            close: this.toNumber(kline.closingPrice),
            volume: this.toNumber(kline.volume),
            isFinal: false,
          },
        );
  
      } catch (err) {
        this.logger.error('MEXC message parse error', err);
      }
    });
  
    this.ws.on('close', () => {
      this.logger.warn('MEXC WS closed. Reconnecting in 3s');
  
      clearInterval(this.pingInterval);
  
      setTimeout(() => {
        this.connect(this.symbols, this.symbolMarketMap,this.symbolMetaMap);
      }, 3000);
    });
  
    this.ws.on('error', err => {
      this.logger.error('MEXC WS error', err);
      this.ws?.close();
    });
  }
  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
  }





  
}











// import WebSocket from 'ws';
// import { Injectable, Logger } from '@nestjs/common';
// import { Exchange } from '@/common/enums/exchanges.enums';
// import { AggregationService } from '@/aggregation/aggregation.service';

// interface Candle {
//   openTime: number;
// }

// @Injectable()
// export class MexcWebSocket {
//   private readonly logger = new Logger(MexcWebSocket.name);
//   private ws?: WebSocket;
//   private pingInterval?: NodeJS.Timeout;

//   // Symbols to subscribe
//   private symbols: string[] = [];

//   // Last candle per symbol
//   private lastCandle: Record<string, Candle> = {};

//   constructor(private readonly aggregationService: AggregationService) { }

//   connect(symbols: string[], symbolMap: Record<string, number>) {
//     this.symbols = symbols;
//     this.ws = new WebSocket('wss://contract.mexc.com/edge');

//     this.ws.on('open', () => {
//       this.logger.log('Connected to MEXC WebSocket');

//       // Subscribe to 1m Kline for all symbols
//       for (const symbol of symbols) {
//         this.ws!.send(
//           JSON.stringify({
//             method: 'sub.kline',
//             param: {
//               symbol: 'BTC_USDT', // dynamic symbol
//               interval: 'Min1',
//             },
//           }),
//         );
//       }

//       // Keep-alive ping every 20 seconds
//       this.pingInterval = setInterval(() => {
//         this.ws?.send(JSON.stringify({ method: 'ping' }));
//       }, 20_000);
//     });

//     this.ws.on('message', (msg) => {
//       try {
//         // console.log("usdt",msg)
//         const json = JSON.parse(msg.toString());
//         // Ping/pong handling
//         if (json.channel === 'pong') {
//           return;
//         }
//         // console.log("symbolMap['BTCUSDT']",symbolMap['BTCUSDT'])
//         // MEXC pushes kline updates in `data`
//         const k = json?.data;
//         // console.log("json",json)
//         if (!k || !k.symbol || !k.t) return;
//         console.log("k", k)
//         const symbol = k.symbol;
//         const symbolId = symbolMap['BTCUSDT'];
//         if (!symbolId) return;
//         let isFinal = false;
//         // Detect candle close: timestamp changed
//         const prev = this.lastCandle[symbol];
//         console.log("prev", prev)
//         const newCandle: Candle = {
//           openTime: k.t
//         };
//         if (prev && prev.openTime !== newCandle.openTime) {
//           isFinal = true;
//         }

//         this.aggregationService.handleLiveCandle(
//           symbolId,
//           Exchange.MEXC,
//           {
//             exchange: Exchange.MEXC,
//             openTime: k.t,
//             open: +k.o,
//             high: +k.h,
//             low: +k.l,
//             close: +k.c,
//             volume: +k.v,
//             isFinal: isFinal,
//           });

//         this.lastCandle[symbol] = newCandle;
//       } catch (err) {
//         this.logger.error('Failed to parse MEXC message', err);
//       }
//     });

//     this.ws.on('close', () => {
//       clearInterval(this.pingInterval);
//       this.logger.warn('MEXC WebSocket closed. Reconnecting in 3s...');
//       setTimeout(() => this.connect(this.symbols, symbolMap), 3000);
//     });

//     this.ws.on('error', (err) => {
//       this.logger.error('MEXC WebSocket error', err);
//       this.ws?.close();
//     });
//   }
// }

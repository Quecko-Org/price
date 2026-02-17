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

  private symbols: string[] = [];
  private lastCandle: Record<string, Candle> = {};
  private toNumber(value?: string | null): number {
    return value ? Number(value) : 0;
  }
  constructor(
    private readonly aggregationService: AggregationService,
  ) {}

  connect(symbols: string[], symbolMap: Record<string, number>) {
    this.symbols = symbols;

    // MEXC Spot WebSocket endpoint
    this.ws = new WebSocket('wss://wbs-api.mexc.com/ws');

    this.ws.on('open', () => {
      this.logger.log('Connected to MEXC SPOT WebSocket');

      // Subscribe to kline streams for all symbols
      // Format: spot@public.kline.v3.api.pb@<SYMBOL>@<INTERVAL>
      // Available intervals: Min1, Min5, Min15, Min30, Min60, Hour4, Hour8, Day1, Week1, Month1
      const params = symbols.map(symbol => 
        `spot@public.kline.v3.api.pb@${symbol}@Min1`
      );

      this.ws!.send(
        JSON.stringify({
          method: 'SUBSCRIPTION',
          params: params,
        }),
      );

      // Keep-alive ping every 20 seconds (required to keep connection alive)
      this.pingInterval = setInterval(() => {
        this.ws?.send(JSON.stringify({ method: 'PING' }));
      }, 20_000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        // Check if this is a JSON message (PONG response)
        if (data[0] === 0x7b) { // '{' character indicates JSON
          const json = JSON.parse(data.toString('utf8'));
          
          // Ignore PONG responses
          if (json?.code === 0 && json?.msg === 'PONG') {
            return;
          }
          
          // Log subscription confirmations
          if (json?.msg && json.msg.includes('spot@public.kline')) {
            this.logger.log(`Subscription confirmed: ${json.msg}`);
          }
          return;
        }

        // Decode protobuf message
        const wrapper = mexc.PushDataV3ApiWrapper.decode(data);
        
        // Extract kline data
        const klineData = wrapper.publicSpotKline;
        if (!klineData) {
          return;
        }

        const symbol = wrapper.symbol;
        const symbolId = symbolMap[symbol];
        
        if (!symbolId) {
          this.logger.warn(`Symbol ${symbol} not found in symbolMap`);
          return;
        }
        
        // Parse kline data
        // Note: timestamps are in seconds, need to convert to milliseconds
        const openTime = Number(klineData.windowStart) * 1000;
        console.log("ashar",openTime,klineData)
        const newCandle = {
          exchange: Exchange.MEXC,
          openTime,
          open: this.toNumber(klineData.openingPrice),
          high: this.toNumber(klineData.highestPrice),
          low: this.toNumber(klineData.lowestPrice),
          close: this.toNumber(klineData.closingPrice),
          volume: this.toNumber(klineData.volume),
          isFinal: false,
        };

        const prev = this.lastCandle[symbol];

        // Detect closed candle (timestamp changed)
        if (prev && prev.openTime !== newCandle.openTime) {
          // Previous candle is now final
          this.aggregationService.handleLiveCandle(
            symbolId,
            Exchange.MEXC,
            {
              exchange:Exchange.MEXC,
              ...prev,
              isFinal: true,
            },
          );
        }

        // Always send live update
        this.aggregationService.handleLiveCandle(
          symbolId,
          Exchange.MEXC,
          newCandle,
        );

        this.lastCandle[symbol] = newCandle;

      } catch (err) {
        this.logger.error('Failed parsing MEXC SPOT message',err);
      }
    });

    this.ws.on('close', () => {
      clearInterval(this.pingInterval);
      this.logger.warn('MEXC SPOT WebSocket closed. Reconnecting in 3s...');
      setTimeout(() => this.connect(this.symbols, symbolMap), 3000);
    });

    this.ws.on('error', (err) => {
      this.logger.error('MEXC SPOT WebSocket error', err);
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

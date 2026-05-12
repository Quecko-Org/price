// ============================================================
// okx.ws.ts
// OKX spot candle stream via WebSocket.
// Subscribes to candle1m channel for each symbol.
// Publishes to Kafka candle.raw topic — same pipeline as Binance/MEXC.
//
// OKX WS docs: https://www.okx.com/docs-v5/en/#overview-websocket
// Candle channel: candle1m (1-minute OHLCV, pushed every 500ms)
// ============================================================
import WebSocket from 'ws';
import { Injectable, Logger } from '@nestjs/common';
import { Exchange } from '@/common/enums/exchanges.enums';
import { KafkaService } from '@/common-module/kafka/kafka.service';

// OKX candle1m args: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
// ts        = open time in milliseconds (string)
// vol       = base volume (BTC for BTC-USDT)
// confirm   = "1" = candle closed, "0" = still open

const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/business';

@Injectable()
export class OkxWebSocket {
  private readonly logger = new Logger(OkxWebSocket.name);
  private sockets: WebSocket[] = [];

  constructor(private readonly kafka: KafkaService) {}

  connect(
    symbols:        string[],                                    // OKX instId format: BTC-USDT
    symbolMarketMap: Record<string, number>,                    // `OKX:BTC-USDT` → marketId
    symbolMetaMap:   Record<string, { base: string; quote: string }>,
    retry=0
  ) {
   

    let isAlive = true;
    let pingInterval: NodeJS.Timeout;

    const ws = new WebSocket(OKX_WS_URL);
    this.sockets.push(ws);
    
    
    ws.on('open', async() => {
      isAlive = true;
 
      const BATCH_SIZE = 20;

      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
    
    

      ws.send(JSON.stringify({
        op: 'subscribe',
        args: symbols.map(instId => ({
          channel: 'candle1m',
          instId,
        })),
      }));
      await new Promise(r => setTimeout(r, 250));
    }
  
  

      // OKX requires a ping every 30s to keep connection alive
      pingInterval = setInterval(() => {
        if (!isAlive) {
          this.logger.warn('OKX: no pong → reconnect');
          ws.terminate();
          return;
        }
        isAlive = false;
        ws.send('ping');
      }, 25_000);
    });
 
    ws.on('message', (data: Buffer) => {
      const raw = data.toString();
      // OKX pong is a plain string
      if (raw === 'pong') {
        isAlive = true;
        return;
      }

      try {
        const msg = JSON.parse(raw);
        // console.log("msgggg",msg)
      
        // Subscription confirmations and errors
        if (msg.event) {
          if (msg.event === 'error') {
            this.logger.error(`OKX subscribe error: ${msg.msg}`);
          }
          return;
        }

        // Candle push: { arg: { channel, instId }, data: [[ts, o, h, l, c, vol, ...]] }
        if (msg.arg?.channel !== 'candle1m' || !msg.data?.length) return;

        const instId = msg.arg.instId as string;               // e.g. "BTC-USDT"
        const key    = `${Exchange.OKX}:${instId}`;

        const marketId = symbolMarketMap[key];
        const meta     = symbolMetaMap[key];
        if (!marketId || !meta) return;

        for (const candle of msg.data) {
          // candle = [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
          const [ts, open, high, low, close, vol, , , confirm] = candle;

          this.kafka.publishCandle(marketId, Exchange.OKX, {
            exchange: Exchange.OKX,
            openTime: Number(ts),
            quote:    meta.quote,
            open:     Number(open),
            high:     Number(high),
            low:      Number(low),
            close:    Number(close),
            volume:   Number(vol),         // base volume — no trust weighting here
            isFinal:  confirm === '1',
          }).catch(err => this.logger.error('OKX Kafka publish failed', err));
        }   

      } catch (err) {
        this.logger.error('OKX parse error', err);
      }
    });
    ws.on('close', () => {
      this.logger.warn('OKX WS closed — reconnecting in 3s');
      clearInterval(pingInterval);
      const delay = Math.min(30000, 1000 * 2 ** retry);

      setTimeout(() => { this.connect(symbols, symbolMarketMap, symbolMetaMap,retry + 1);},delay      );
    });

    ws.on('error', err => {
      this.logger.error('OKX WS error', err);
      ws.close();
    });
  }
}
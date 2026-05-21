
// ============================================================
// kafka-producer.service.ts
// Single producer used by all exchange WebSockets and DEX adapters.
// Each message type goes to its own topic, partitioned by marketId
// so consumers for the same market always hit the same partition
// (ordering guarantee within a market, parallelism across markets).
// ============================================================
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import { ExchangeLiveCandle } from '@/common/types/candle.type';
import { Exchange } from '@/common/enums/exchanges.enums';

export const TOPICS = {
  CANDLE_RAW: 'candle.raw',   // CEX kline ticks (Binance, MEXC)
  DEX_SWAP:   'dex.swap',     // Uniswap V3/V4 swap events
  FX_RATES:   'fx.rates',     // Frankfurter rate updates
} as const;

export interface RawCandleMessage {
  marketId: number;
  exchange: Exchange;
  candle:   ExchangeLiveCandle;
}

export interface DexSwapMessage {
  marketId:     number;
  exchange:     Exchange;
  priceUsd:     number;
  baseVolume:   number;
  openTime:     number;
}

export interface FxRateMessage {
  rates: Record<string, number>;
  ts:    number;
}

@Injectable()
export class KafkaService implements OnModuleInit,OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private producer: Producer;

  private readonly kafka = new Kafka({
    clientId: 'price-aggregator-producer',
    brokers:  (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    retry: { retries: 5 },
  });

  async onModuleInit() {
    this.producer = this.kafka.producer({
      // Allow batching small messages — reduces broker round-trips
      // for high-frequency tick data
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
    await this.producer.connect();
    this.logger.log('✅ Kafka producer connected');
  } 
 
  // ── CEX kline tick ─────────────────────────────────────────
  async publishCandle(marketId: number, exchange: Exchange, candle: ExchangeLiveCandle) {
    const msg: RawCandleMessage = { marketId, exchange, candle };
    await this.producer.send({
      topic:       TOPICS.CANDLE_RAW,
      compression: CompressionTypes.GZIP,
      messages: [{
        // Partition by marketId → same market always same partition
        key:   String(marketId),
        value: JSON.stringify(msg),
      }],
    });
  }

  // ── DEX swap ───────────────────────────────────────────────
  async publishDexSwap(swap: DexSwapMessage) {
    await this.producer.send({
      topic: TOPICS.DEX_SWAP,
      messages: [{
        key:   String(swap.marketId),
        value: JSON.stringify(swap),
      }],
    });
  }

  // ── FX rate update ─────────────────────────────────────────
  async publishFxRates(rates: Record<string, number>) {
    const msg: FxRateMessage = { rates, ts: Date.now() };
    await this.producer.send({
      topic: TOPICS.FX_RATES,
      messages: [{ key: 'fx', value: JSON.stringify(msg) }],
    });
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }
}
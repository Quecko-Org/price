import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import { ExchangeLiveCandle } from '@/common/types/candle.type';
import { Exchange } from '@/common/enums/exchanges.enums';

export const TOPICS = {
  CANDLE_RAW: 'candle.raw',
  DEX_SWAP:   'dex.swap',
  FX_RATES:   'fx.rates',
} as const;

export interface RawCandleMessage { marketId: number; exchange: Exchange; candle: ExchangeLiveCandle }
export interface DexSwapMessage   { marketId: number; exchange: Exchange; priceUsd: number; baseVolume: number; openTime: number }
export interface FxRateMessage    { rates: Record<string, number>; ts: number }

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private producer!: Producer;
  private connected = false;

  // Supports both env var names:
  //   KAFKA_BROKERS           (your current .env)
  //   KAFKA_BOOTSTRAP_SERVERS (DevOps env)
  private readonly kafka = new Kafka({
    clientId: 'price-aggregator-producer',
    brokers: (
      process.env.KAFKA_BROKERS ??
      process.env.KAFKA_BOOTSTRAP_SERVERS ??
      'localhost:9092'
    ).split(','),
    retry: { retries: 5, initialRetryTime: 300 },
  });

  async onModuleInit() {
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout:     30_000,
    });
    try {
      await this.producer.connect();
      this.connected = true;
      this.logger.log('✅ Kafka producer connected');
    } catch (err: any) {
      this.connected = false;
      this.logger.error(
        `❌ Kafka connection failed: ${err?.message}\n` +
        `   Running in direct mode — aggregation works without Kafka.`
      );
    }
  }

  isConnected(): boolean { return this.connected; }

  async publishCandle(marketId: number, exchange: Exchange, candle: ExchangeLiveCandle): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.send({
        topic:       TOPICS.CANDLE_RAW,
        compression: CompressionTypes.GZIP,
        messages: [{ key: String(marketId), value: JSON.stringify({ marketId, exchange, candle }) }],
      });
    } catch (err: any) {
      this.connected = false;
      this.logger.error(`Kafka publishCandle failed: ${err?.message}`);
    }
  }

  async publishDexSwap(swap: DexSwapMessage): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.send({
        topic:    TOPICS.DEX_SWAP,
        messages: [{ key: String(swap.marketId), value: JSON.stringify(swap) }],
      });
    } catch (err: any) {
      this.connected = false;
      this.logger.error(`Kafka publishDexSwap failed: ${err?.message}`);
    }
  }

  async publishFxRates(rates: Record<string, number>): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.send({
        topic:    TOPICS.FX_RATES,
        messages: [{ key: 'fx', value: JSON.stringify({ rates, ts: Date.now() }) }],
      });
    } catch (err: any) {
      this.connected = false;
      this.logger.error(`Kafka publishFxRates failed: ${err?.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.producer.disconnect();
  }
}
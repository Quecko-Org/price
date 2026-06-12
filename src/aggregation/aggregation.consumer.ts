// ============================================================
// aggregation.consumer.ts
//
// Consumes candle.raw + dex.swap topics.
// Maintains in-memory live buffer per (marketId, minute).
// On minute close → aggregate → write Redis + TimescaleDB.
//
// WHY Kafka here:
//   WebSocket handlers (Binance/MEXC) are I/O-bound and can spike.
//   Kafka decouples ingestion from aggregation — if the DB is slow,
//   ticks queue in Kafka instead of blocking the WS message loop.
//   Consumer group allows horizontal scaling: add a second instance
//   and Kafka re-balances partitions automatically.
// ============================================================
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { Candle1mEntity } from '@/aggregation/entities/candle-1m.entity';
import { PriceCacheService } from '@/common-module/price-cache-service/price-cache.service';
import { aggregateCandles } from '@/common/utils/price-weighting.util';
import { LiveCandleBuffer } from '@/aggregation/live/live-buffer';
import { ExchangeCandle, ExchangeLiveCandle } from '@/common/types/candle.type';
import { Exchange } from '@/common/enums/exchanges.enums';
import { RedisService } from '@/common-module/redis/redis.service';
import { TOPICS, RawCandleMessage, DexSwapMessage, FxRateMessage } from '@/common-module/kafka/kafka.service';

@Injectable()
export class AggregationConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger  = new Logger(AggregationConsumer.name);
  private readonly buffer  = new LiveCandleBuffer();
  private consumer!:Consumer;
  private flushTimer!: NodeJS.Timeout;

  // marketId → { base, quote }
  private marketCache = new Map<number, { base: string; quote: string }>();

  private readonly kafka = new Kafka({
    clientId: 'price-aggregator-consumer',
       brokers: (
      process.env.KAFKA_BROKERS ??
      process.env.KAFKA_BOOTSTRAP_SERVERS ??
      'localhost:9092'
    ).split(','),
  });

  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    private readonly redis:       RedisService,
    private readonly priceCache:  PriceCacheService,
  ) {}

  async onModuleInit() {
    this.consumer = this.kafka.consumer({
      groupId:         'aggregation-group',
      sessionTimeout:  30_000,
      heartbeatInterval: 3_000,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [TOPICS.CANDLE_RAW, TOPICS.DEX_SWAP, TOPICS.FX_RATES], fromBeginning: false });

    await this.consumer.run({
      // autoCommit after each message batch
      eachMessage: async (payload: EachMessagePayload) => {
        try {
          await this.handleMessage(payload);
        } catch (err) {
          this.logger.error(`Consumer error topic=${payload.topic}`, err);
        }
      },
    });

    // Flush closed minutes every 5s — same cadence as before
    this.flushTimer = setInterval(() => this.flushClosedMinutes(), 5_000);

    this.logger.log('✅ Aggregation consumer started');
  }

  // ── Route by topic ────────────────────────────────────────
  private async handleMessage({ topic, message }: EachMessagePayload) {
    if (!message.value) return;
    const raw = message.value.toString();

    if (topic === TOPICS.CANDLE_RAW) {
      const msg: RawCandleMessage = JSON.parse(raw);
      await this.handleRawCandle(msg.marketId, msg.exchange, msg.candle);
    }

    if (topic === TOPICS.DEX_SWAP) {
      const msg: DexSwapMessage = JSON.parse(raw);
      this.handleDexSwap(msg);
    }

    if (topic === TOPICS.FX_RATES) {
      const msg: FxRateMessage = JSON.parse(raw);
      this.priceCache.updateFiatRates(msg.rates);
      // Also write to Redis so other instances pick it up
      await this.redis.setFxRates(msg.rates);
    }
  }

  // ── CEX kline tick ────────────────────────────────────────
  private async handleRawCandle(marketId: number, exchange: Exchange, candle: ExchangeLiveCandle) {
        // console.log("handleRawCandle")

    // Convert price to USD using priceCache (loaded from Redis on startup)
    const usdOpen  = this.priceCache.convertToUSD(candle.open,  candle.quote);
    const usdHigh  = this.priceCache.convertToUSD(candle.high,  candle.quote);
    const usdLow   = this.priceCache.convertToUSD(candle.low,   candle.quote);
    const usdClose = this.priceCache.convertToUSD(candle.close, candle.quote);

    if (!usdOpen || !usdHigh || !usdLow || !usdClose) return;

    const minute = this.minuteBucket(candle.openTime);
    let entry = this.buffer.get(marketId, minute);
    if (!entry) {
      entry = { openTime: minute, exchanges: new Map() };
    }

    entry.exchanges.set(exchange, {
      exchange,
      openTime: candle.openTime,
      open:     usdOpen,
      high:     usdHigh,
      low:      usdLow,
      close:    usdClose,
      volume:   candle.volume || 0, // raw base volume — NOT trust-weighted
    });
   
    this.buffer.add(marketId, entry);
  }

  // ── DEX swap tick ─────────────────────────────────────────
  // DEX swaps are already in USD and base volume — insert directly
  private handleDexSwap(msg: DexSwapMessage) {
    // console.log("handleDexSwap")
    const minute = this.minuteBucket(msg.openTime);
    let entry = this.buffer.get(msg.marketId, minute);
    if (!entry) {
      entry = { openTime: minute, exchanges: new Map() };
    }

    entry.exchanges.set(msg.exchange, {
      exchange:  msg.exchange,
      openTime:  msg.openTime,
      open:      msg.priceUsd,
      high:      msg.priceUsd,
      low:       msg.priceUsd,
      close:     msg.priceUsd,
      volume:    msg.baseVolume,
    });

    this.buffer.add(msg.marketId, entry);
  }

  // ── Flush closed minutes ──────────────────────────────────
  private async flushClosedMinutes() {
    const now = Date.now();

    for (const { symbolId, openTime } of this.buffer.entries()) {
    
      if (now < openTime + 70_000) continue; // not yet closed
      const entry = this.buffer.get(symbolId, openTime);

      if (!entry) continue;

      const candles = Array.from(entry.exchanges.values()).filter(c =>
        c.high > 0 && c.low > 0 && c.volume > 0 && c.high < 10_000_000
      );
      if (!candles.length) continue;

      const agg = aggregateCandles(candles);
      if (!agg) continue;

      // ✅ Update in-memory price cache + Redis
      const market = this.marketCache.get(symbolId);
 
      if (market?.quote === 'USD') {
        this.priceCache.updateCryptoPrice(market.base, agg.weightedClose);
        // Push to Redis so all instances and the API get updated price
    
        await this.redis.setPrice(market.base, agg.weightedClose);
        // Publish live candle to Redis pub/sub for WebSocket clients
        await this.redis.publishLiveCandle(symbolId, {
          t: Math.floor(openTime / 1000),
          o: agg.open,
          h: agg.high,
          l: agg.low,
          c: agg.weightedClose,
          v: agg.baseVolume,
        });
      }

      // Persist to TimescaleDB
      await this.candleRepo.upsert(
        {
          marketId:   symbolId,
          openTime:   new Date(openTime),
          open:       agg.open,
          high:       agg.high,
          low:        agg.low,
          close:      agg.weightedClose,
          baseVolume: agg.baseVolume,
          volume:     agg.baseVolume,
          volumeUSDT: agg.volumeUSDT,
        },
        ['marketId', 'openTime'],
      );

      // Cache latest candle in Redis for fast API reads
      await this.redis.setLatestCandle(symbolId, {
        openTime,
        open:       agg.open,
        high:       agg.high,
        low:        agg.low,
        close:      agg.weightedClose,
        baseVolume: agg.baseVolume,
        volumeUSDT: agg.volumeUSDT,
      });

      this.buffer.clear(symbolId, openTime);
    }
  }

  setMarketCache(cache: Map<number, { base: string; quote: string }>) {
    this.marketCache = cache;
  }

  private minuteBucket(ts: number): number {
    const d = new Date(ts);
    d.setSeconds(0, 0);
    return d.getTime();
  }

  async onModuleDestroy() {
    clearInterval(this.flushTimer);
    await this.consumer.disconnect();
  }
}
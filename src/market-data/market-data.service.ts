import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Exchange } from "@/common/enums/exchanges.enums";
import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
import { BinanceWebSocket } from "@/ingestion/exchanges/binance/binance.ws";
import { MexcWebSocket } from "@/ingestion/exchanges/mexc/mexc.ws";
import { MarketEntity } from "./market.entity";
import { Candle1mEntity } from "@/aggregation/entities/candle-1m.entity";
import { RedisService } from "@/common-module/redis/redis.service";
import { AggregationConsumer } from "@/aggregation/aggregation.consumer";
import { OkxWebSocket } from "@/ingestion/exchanges/okx/oks.ws";

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);
  private marketCache = new Map<number, { base: string; quote: string }>();


  constructor(
    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,

    private readonly binanceWs: BinanceWebSocket,
    private readonly mexcWs: MexcWebSocket,
    private readonly okxWs: OkxWebSocket,
    private readonly redis: RedisService,
    private readonly consumer: AggregationConsumer
  ) { }

  async onModuleInit() {

    this.logger.log("Starting market WS engine");

    const symbols = await this.symbolRepo.find({
      relations: ["exchanges", "market"],
    });
    console.log("symbols", symbols.length)
    const symbolMarketMap: Record<string, number> = {};
    const symbolMetaMap: Record<string, { base: string; quote: string }> = {};

    for (const s of symbols) {
      for (const ex of s.exchanges) {

        const key = `${ex.exchange}:${s.symbol.toUpperCase()}`;

        symbolMarketMap[key] = s.market.id;

        symbolMetaMap[key] = {
          base: s.base,
          quote: s.quote,
        };

        this.marketCache.set(s.market.id, { base: s.base, quote: s.quote });

      }


    }


    this.consumer.setMarketCache(this.marketCache);

    /*
    ==========================
    BINANCE SHARDING
    ==========================
    */

    const binanceSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
      .map(s => s.symbol);

    const BINANCE_CHUNK = 180;

    for (let i = 0; i < binanceSymbols.length; i += BINANCE_CHUNK) {

      const chunk = binanceSymbols.slice(i, i + BINANCE_CHUNK);

      // this.logger.log(`Launching Binance WS (${chunk.length} symbols)`);

      this.binanceWs.connect(chunk, symbolMarketMap, symbolMetaMap);
    }

    /*
    ==========================
    MEXC SHARDING
    ==========================
    */

    const mexcSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
      .map(s => s.symbol);

    const MEXC_CHUNK = 25;

    for (let i = 0; i < mexcSymbols.length; i += MEXC_CHUNK) {

      const chunk = mexcSymbols.slice(i, i + MEXC_CHUNK);

      // this.logger.log(`Launching MEXC WS (${chunk.length} symbols)`);

      this.mexcWs.connect(chunk, symbolMarketMap, symbolMetaMap);
    }



    // ── OKX (max 240 subscriptions per WS connection) ─────────
    // OKX uses instId format: BTC-USDT (with hyphen)
    // Your symbolRepo may store as BTCUSDT — map accordingly
    const okxSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.OKX))
      .map(s => {
        // OKX key uses instId (BTC-USDT) — stored in symbol field for OKX
        return s.symbol; // ensure OKX symbols are stored as BTC-USDT format
      });

    console.log("okxxx", okxSymbols.length, okxSymbols[0])
    const OKX_CHUNK = 100;

    for (let i = 0; i < okxSymbols.length; i += OKX_CHUNK) {
      this.okxWs.connect(okxSymbols.slice(i, i + OKX_CHUNK), symbolMarketMap, symbolMetaMap);
    }

    this.logger.log(
      `✅ WS engine started: ${binanceSymbols.length} Binance, ` +
      `${mexcSymbols.length} MEXC, ${okxSymbols.length} OKX`
    );











  }


  async findBySymbol(symbol: string) {

    return this.marketRepo.findOne({
      where: {
        base: symbol,
      },
    });
  }


  async getAllTokens(page = 1, limit = 10) {
    const [data, total] = await this.marketRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: {
        id: 'ASC',
      },
    });

    return {
      data,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }


  async getTokenDetail(symbol: string) {
    const token = await this.symbolRepo.find({
      where: { base: symbol },
      relations: ['market', 'exchanges'],
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    return token;
  }



  async getTopMarkets(filter: {
    symbols?: string;
    limit?: number;
  }) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const limit = filter.limit || 50;
    const cacheKey = `top:markets:${filter.symbols ?? 'all'}:${limit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const query = this.candleRepo
      .createQueryBuilder('candle')
      .innerJoin('candle.market', 'market')

      // last 24h
      .where('candle.openTime >= :since', { since });

    // ✅ IN operator
    if (filter.symbols) {
      query.andWhere('market.symbol IN (:...symbols)', {
        symbols: filter.symbols.split(','),
      });
    }

    query
      // base fields
      .select('candle.marketId', 'marketId')
      .addSelect('market.symbol', 'symbol')
      .addSelect('market.base', 'base')
      .addSelect('market.quote', 'quote')

      // ✅ 24h volume
      .addSelect('SUM(candle.volumeUSDT)', 'volume24h')

      // ✅ latest price
      .addSelect(`
            (
              SELECT c2.close
              FROM aggregated_candles_1m c2
              WHERE c2."marketId" = candle."marketId"
              ORDER BY c2."openTime" DESC
              LIMIT 1
            )
          `, 'lastPrice')

      // ✅ price 24h ago
      .addSelect(`
            (
              SELECT c3.close
              FROM aggregated_candles_1m c3
              WHERE c3."marketId" = candle."marketId"
              AND c3."openTime" <= :since
              ORDER BY c3."openTime" DESC
              LIMIT 1
            )
          `, 'price24hAgo')

      .groupBy('candle.marketId')
      .addGroupBy('market.symbol')
      .addGroupBy('market.base')
      .addGroupBy('market.quote')

      .orderBy('volume24h', 'DESC')
      .limit(limit)
      .setParameter('since', since);

    const result = await query.getRawMany();

    const response = result.map((r) => {
      const lastPrice = Number(r.lastPrice);
      const oldPrice = Number(r.price24hAgo);

      const change24h =
        oldPrice > 0
          ? ((lastPrice - oldPrice) / oldPrice) * 100
          : 0;

      return {
        marketId: Number(r.marketId),
        symbol: r.symbol,
        base: r.base,
        quote: r.quote,
        price: lastPrice,
        volume24h: Number(r.volume24h),
        change24h: Number(change24h.toFixed(2)),
      };
    });
    await this.redis.setex(cacheKey, 60, JSON.stringify(response));
    return response;
  }
}


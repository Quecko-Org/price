import { Any, Repository } from "typeorm";
import { Candle1mEntity } from "./entities/candle-1m.entity";
import { BinanceService } from "@/ingestion/exchanges/binance/binance.service";
import { MexcService } from "@/ingestion/exchanges/mexc/mexc.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Injectable } from "@nestjs/common";
import { ExchangeCandle, ExchangeLiveCandle, LiveBufferEntry } from "@/common/types/candle.type";
import { CandleInterval, Exchange } from "@/common/enums/exchanges.enums";
import { aggregateCandles } from "@/common/utils/price-weighting.util";
import { SymbolsService } from "@/ingestion/symbols/symbol.service";
import { error } from "console";
import { SymbolExchangeEntity } from "@/ingestion/symbols/entities/symbol-exchange.entity";
import axios from "axios";
import { LiveCandleBuffer } from "./live/live-buffer";
import { Cron } from "@nestjs/schedule";

@Injectable()
export class AggregationService {
  private liveBuffer = new LiveCandleBuffer();

  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    @InjectRepository(SymbolExchangeEntity)
    private readonly symbolExchangeRepo: Repository<SymbolExchangeEntity>,
    private readonly binance: BinanceService,
    private readonly mexc: MexcService,
    private readonly symbolsService: SymbolsService,



  ) { }




  //backfill aggreagtion start
  async fetchFirstCandleTime(symbol: string, exchange: Exchange): Promise<Date> {
    if (exchange == Exchange.BINANCE) {
      console.log("binance first candle")
      const res = await this.binance.fetchFirstCandleTime(symbol);

      return new Date(res);// openTime
    }
    if (exchange == Exchange.MEXC) {
      console.log("mexc first candle");

      const res = await this.mexc.fetchFirstCandleTime(symbol);

      return new Date(res);// openTime
    }
    return new Date();
  }

  async getLastCandleTime(symbolId: number): Promise<Date | null> {
    const result = await this.candleRepo
      .createQueryBuilder('c')
      // .select('MAX(c.time)', 'max')
      .where('c.symbolId = :symbolId', { symbolId })
      .getRawOne();

    return result?.max ? new Date(result.max) : null;
  }


  // async backfillSymbol(symbolId: number, symbol: string) {
  //   const [binance, mexc] = await Promise.all([
  //     this.binance.fetch1mCandles(symbol),
  //     this.mexc.fetch1mCandles(symbol),
  //   ]);

  //   const grouped = new Map<number, ExchangeCandle[]>();

  //   for (const b of binance) {
  //     grouped.set(b.openTime, [
  //       ...(grouped.get(b.openTime) || []),
  //       { exchange: Exchange.BINANCE, ...b },
  //     ]);
  //   }

  //   for (const m of mexc) {
  //     grouped.set(m.openTime, [
  //       ...(grouped.get(m.openTime) || []),
  //       { exchange: Exchange.MEXC, ...m },
  //     ]);
  //   }

  //   for (const [time, candles] of grouped) {
  //     const agg = aggregateCandles(candles);

  //     await this.candleRepo.upsert(
  //       {
  //         time: new Date(time),
  //         symbolId,
  //         ...agg,
  //       },
  //       ['time', 'symbolId'],
  //     );
  //   }
  // }
  async backfillSymbol(symbolId: number, symbol: string) {


    const exchanges =
      await this.symbolsService.getExchangesForSymbol(symbolId);
    console.log("backfillSymbol", exchanges, symbol)

    if (!exchanges.length) return;
    const grouped = new Map<number, ExchangeCandle[]>();
    for (const se of exchanges) {
      // 1️⃣ Ensure first candle time
      if (!se.firstCandleTime) {
        se.firstCandleTime =
          await this.fetchFirstCandleTime(symbol, se.exchange);
        console.log("fetchFirstCandleTime exchange", se.exchange, se.firstCandleTime)
        await this.symbolExchangeRepo.save(se);
      }

      // 2️⃣ Determine resume time
      const startTime =
        se.lastSyncedAt ?? se.firstCandleTime;
      console.log("startTime", startTime)
      let candles: any = [];

      if (se.exchange === Exchange.BINANCE) {
        // candles = await this.binance.fetch1mCandles(symbol, startTime);
        console.log("candlescandlescandlescandles", candles.length)
      }



      if (se.exchange === Exchange.MEXC) {
        // candles = await this.mexc.fetch1mCandles(symbol, startTime);
        // console.log("mex",candles[0]);
      }
      for (const c of candles) {
        grouped.set(c.openTime, [
          ...(grouped.get(c.openTime) || []),
          { exchange: se.exchange, ...c },
        ]);
      }




      // 5️⃣ Advance cursor
      if (candles.length) {
        const last = candles[candles.length - 1];
        se.lastSyncedAt = new Date(last.openTime + 60_000);
        await this.symbolExchangeRepo.save(se);
      }
    }

    for (const [time, candles] of grouped) {
      // console.log("mex",candles)

      const agg = aggregateCandles(candles);
      // console.log("byeeee",agg)
      await this.candleRepo.upsert(
        {
          openTime: new Date(time),

          ...agg,
        },
        ['symbolId', 'openTime'],
      );




      // await this.repo
      //   .createQueryBuilder()
      //   .insert()
      //   .into(AggregatedCandle1m)
      //   .values({
      //     symbolId,
      //     openTime, // 👈 EXACT candle open time
      //     open,
      //     high,
      //     low,
      //     close,
      //     volume,
      //   })
      //   .orUpdate(
      //     ['open', 'high', 'low', 'close', 'volume'],
      //     ['symbol_id', 'open_time'],
      //   )
      //   .execute();








    }
  }
  //backfill aggreagtion end










  //live CEX aggreagtion start

  async handleLiveCandle(
    marketId: number,
    exchange: Exchange,
    candle: ExchangeLiveCandle,
  ) {
    const STABLES = ['USDT', 'USDC', 'FDUSD', 'TUSD'];

    let fxRate = 1;
  
    if (!STABLES.includes(candle.quote)) {
      fxRate = this.symbolsService.getRate(candle.quote);
      if (!fxRate || fxRate <= 0) return;
    }
    const usdCandle = {
      exchange,
      openTime: candle.openTime,
      open: candle.open * fxRate,
      high: candle.high * fxRate,
      low: candle.low * fxRate,
      close: candle.close * fxRate,
      quote: 'USD',
      volume: candle.volume,
    };
  
    const minute = this.minuteBucket(candle.openTime);
  
    let existing = this.liveBuffer.get(marketId, minute);
  
    if (!existing) {
      existing = {
        openTime: minute,
        exchanges: new Map(),
      };
    }
  
    // replace latest exchange candle
    existing.exchanges.set(exchange, usdCandle);
  
    this.liveBuffer.add(marketId, existing);
  }
  @Cron('*/5 * * * * *')
async flushClosedMinutes() {
  const now = Date.now();

  for (const { symbolId, openTime, candle } of this.liveBuffer.entries()) {
    if (now < openTime + 70_000) continue;
// console.log("candle",candle)
    const exchangeCandles = Array.from(candle.exchanges.values());
    // console.log("exchangeCandles",exchangeCandles)


    
    if (!exchangeCandles.length) continue;

    // Filter obviously invalid candles
    const validCandles = exchangeCandles.filter(c =>
      c.high > 0 && c.low > 0 && c.high < 1_000_000 && c.low < 1_000_000
    );

    if (!validCandles.length) continue;

    const aggregated = aggregateCandles(exchangeCandles);

    if (!aggregated) continue;

    await this.candleRepo.upsert(
      {
        marketId: symbolId,
        openTime: new Date(openTime),
        open: aggregated.open,
        high: aggregated.high,
        low: aggregated.low,
        close: aggregated.close,
        baseVolume:aggregated.baseVolume,
        volume:aggregated.baseVolume,
        volumeUSDT:aggregated.volumeUSDT,
      },
      ['marketId', 'openTime'],
    );

    this.liveBuffer.clear(symbolId, openTime);
  }
}







  

  // async handleLiveCandle(marketId: number, exchange: Exchange, candle: ExchangeLiveCandle) {
  //   // console.log("marketId: number, exchange: Exchange, candle",marketId, exchange, candle)
  //     const fxRate = this.symbolsService.getRate(candle.quote);
  //     console.log("fxRate",fxRate,candle.quote)

  //     const usdCandle = {
  //       ...candle,
  //       open: candle.open * fxRate,
  //       high: candle.high * fxRate,
  //       low: candle.low * fxRate,
  //       close: candle.close * fxRate,
  //       quote: 'USD',
  //     };
  
  //     const minute = this.minuteBucket(usdCandle.openTime);
  //     let existing = this.liveBuffer.get(marketId, minute);
  //     if (!existing) {
  //       existing = {
  //         openTime: minute,
  //         open: usdCandle.open,
  //         high: usdCandle.high,
  //         low: usdCandle.low,
  //         close: usdCandle.close,
  //         volume: 0,
  //         weightedPriceSum: 0,
  //         weightSum: 0,
  //         exchanges: new Map(),
  //       };
  //     }
  
  //     existing.high = Math.max(existing.high, usdCandle.high);
  //     existing.low = Math.min(existing.low, usdCandle.low);
  
  //     const prev = existing.exchanges.get(exchange);
  //     if (prev) {
  //       existing.weightedPriceSum -= prev.price * prev.volume;
  //       existing.weightSum -= prev.volume;
  //     }
  
  //     existing.exchanges.set(exchange, { price: usdCandle.close, volume: usdCandle.volume || candle.volume });
  //     existing.weightedPriceSum += usdCandle.close * (usdCandle.volume || candle.volume);
  //     existing.weightSum += usdCandle.volume || candle.volume;
  //     existing.volume += usdCandle.volume || candle.volume;
  
  //     this.liveBuffer.add(marketId, existing);
  //   }
  
  //   @Cron('*/5 * * * * *')
  //   async flushClosedMinutes() {
  //     const now = Date.now();
    
  //     for (const { symbolId, openTime, candle } of this.liveBuffer.entries()) {
  //       if (now < openTime + 70_000) continue;
  //       const candle = this.liveBuffer.get(symbolId, openTime);
  //       if (!candle) return;
    
  //       const closeUsd =
  //         candle.weightSum > 0 ? candle.weightedPriceSum / candle.weightSum : candle.open;
    
       
    
  //       await this.candleRepo.upsert(
  //         {
  //           marketId: symbolId,
  //           openTime: new Date(openTime),
  //           open: candle.open,
  //           high: candle.high,
  //           low: candle.low,
  //           close: closeUsd,
  //           volume: candle.volume,
  //         },
  //         ['marketId', 'openTime', ],
  //       );
    
  //       this.liveBuffer.clear(symbolId, openTime);
  //     }
  //   }
    private minuteBucket(timestamp: number) {
      const d = new Date(timestamp);
      d.setSeconds(0, 0);
      return d.getTime();
    }

  //live CEX aggreagtion end





  //live DEX aggreagtion start
  //live DEX aggreagtion end



}



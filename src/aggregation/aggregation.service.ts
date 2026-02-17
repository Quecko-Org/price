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

          symbolId,
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










  //live aggreagtion start

  async handleLiveCandle(
    symbolId: number,
    exchange: Exchange,
    candle: ExchangeLiveCandle,
  ) {
    let existing = this.liveBuffer.get(symbolId, candle.openTime);
console.log("handleLiveCandle",exchange,symbolId, candle.openTime,candle)
    if (!existing || !Array.isArray(existing.sources)) {
      existing = {
        openTime: candle.openTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: 0,
        sources: [],
      };
    }
    existing.openTime = candle.openTime;
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  
    existing.sources.push({
      exchange,
      price: candle.close,
      volume: candle.volume,
    });
  
    // ⚡ Store the aggregated object, not the raw candle
    this.liveBuffer.add(symbolId, existing);
    // SAVE ONLY WHEN CANDLE CLOSED
    if (candle.isFinal) {
      this.flush(symbolId, candle.openTime);
    }
  }


  private async flush(symbolId: number, openTime: number) {

    const candle = this.liveBuffer.get(symbolId,openTime);
    if (!candle) return;

    // const candles = this.liveBuffer.get(symbolId, candle.openTime);
    // const agg = aggregateCandles(candles);

    // if (!agg) return;
    const weightedClose = this.weightedPrice(candle.sources);
    // {
    //   symbolId,
    //   openTime: new Date(candle.openTime),
    //   interval: CandleInterval.M1,
    //   ...agg,
    // },
    console.log("dfdfd")
    await this.candleRepo.upsert(
      {
        symbolId,
        openTime: new Date(openTime),
        interval: CandleInterval.M1,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: weightedClose,
        volume: candle.volume,
      },
      ['symbolId', 'openTime', 'interval'],
    );

    this.liveBuffer.clear(symbolId,openTime);
  }

  private weightedPrice(sources: any[]) {
    let sum = 0;
    let total = 0;

    for (const s of sources) {
      sum += s.price * s.volume;
      total += s.volume;
    }

    return total === 0
      ? sources.at(-1)?.price
      : sum / total;
  }




  //live aggreagtion end


}



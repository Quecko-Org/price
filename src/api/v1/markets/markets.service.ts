
import { Injectable } from '@nestjs/common';
import { MarketsRepository } from './markets.repository';

@Injectable()
export class MarketsService {

  constructor(private readonly repo: MarketsRepository) { }

  async getMarkets(
    marketId: number,
    interval: string,
    from?: number,
    to?: number,
    limit?: number,
  ) {

    const rows = await this.repo.getMarkets(
      marketId,
      interval,
      from,
      to,
      limit,
    );

    return rows.map(r => ({
      t: Math.floor(new Date(r.openTime).getTime() / 1000),
      o: +r.open,
      h: +r.high,
      l: +r.low,
      c: +r.close,
      v: +r.volume,
    }));
  }


  async getLatestPrice(marketId: number) {

    const rows = await this.repo.getLatestPrice(
      marketId
    );


    return {
      time: rows[0]?.openTime,
      price: rows[0]?.close ?? null
    }
  }




  async get24hStats(marketId: number) {
    const rows = await this.repo.get24hStats(
      marketId,

    );


    const r = rows[0];
    return {
      high: +r.high,
      low: +r.low,
      volumeBase: r.baseVolume,
      volumeUsdt: r.volumeUSDT,

    };
  }

}
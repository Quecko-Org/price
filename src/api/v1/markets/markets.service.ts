
import { Injectable } from '@nestjs/common';
import { MarketsRepository } from './markets.repository';

@Injectable()
export class MarketsService {

  constructor(private readonly repo: MarketsRepository) {}

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
    

    return rows[0]?.close ?? null;
  }




  async get24hStats(marketId: number,  from?: number,
    to?: number) {
    const rows = await this.repo.get24hStats(
      marketId,
      from,
      to,
    );

   
    const r = rows[0];
console.log("roww",rows)
    return {
      high: +r.high,
      low: +r.low,
      volume: +r.volume,
      // change24h: ((r.close - r.open) / r.open) * 100,
    };
  }

}
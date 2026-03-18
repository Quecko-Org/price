import { intervalTable } from '@/common/utils/interval.util';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class MarketsRepository {

  constructor(private readonly dataSource: DataSource) {}

  async getMarkets(
    marketId: number,
    interval: string,
    from?: number,
    to?: number,
    limit = 500,
  ) {
console.log("interval",interval,marketId)
    const table = intervalTable(interval);

    const params: any[] = [marketId];
let whereClauses = ['"marketId" = $1']; // quote marketId just to be safe
let paramIndex = 2;

if (from) {
  params.push(new Date(from * 1000));
  whereClauses.push(`"openTime" >= $${paramIndex}`);
  paramIndex++;
}

if (to) {
  params.push(new Date(to * 1000));
  whereClauses.push(`"openTime" <= $${paramIndex}`);
  paramIndex++;
}

params.push(limit); // last param for LIMIT
const limitIndex = params.length;

const query = `
  SELECT
    "openTime",
    "open",
    "high",
    "low",
    "close",
    "volume"
  FROM ${table}
  WHERE ${whereClauses.join(' AND ')}
  ORDER BY "openTime" ASC
  LIMIT $${limitIndex};
`;

try {
  const rows = await this.dataSource.query(query, params);
  return rows;
} catch (err) {
  console.error('Failed fetching candles:', err);
  throw err;
}

  }





  async getLatestPrice(
    marketId: number,
  
  ) {

    const rows = await this.dataSource.query(`
      SELECT close
      FROM aggregated_candles_1m
      WHERE "marketId" = $1
      ORDER BY "openTime" DESC
      LIMIT 1
    `,[marketId]);

    return rows;
  }




  async get24hStats(
    marketId: number
  ) {

   let froms = Math.floor(Date.now() / 1000);
let tos = froms - (24 * 60 * 60); // 24 hou

console.log("df",froms,tos)
    const row = await this.dataSource.query(`
    SELECT
    first(open, "openTime") as open,
    last(close, "openTime") as close,
    max(high) as high,
    min(low) as low,
    sum(volume) as volume
  FROM aggregated_candles_1m
  WHERE "marketId" = $1
  AND "openTime" >= NOW() - INTERVAL '24 hours'
  `,[marketId]);
  return row;


  }



}
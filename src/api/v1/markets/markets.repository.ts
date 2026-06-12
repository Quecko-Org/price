// ============================================================
// markets.repository.ts — all DB queries for markets APIs
// ============================================================
import { intervalTable } from '@/common/utils/interval.util';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
 
@Injectable()
export class MarketsRepository {

  constructor(private readonly dataSource: DataSource) {}
 
  // ── EXISTING ─────────────────────────────────────────────────

  async getMarkets(marketId: number, interval: string, from?: number, to?: number, limit = 500) {
    const table = intervalTable(interval);
    const params: any[] = [marketId];
    const where = ['"marketId" = $1']; 
    let i = 2;
    if (from) { params.push(new Date(from * 1000)); where.push(`"openTime" >= $${i++}`); }
    if (to)   { params.push(new Date(to * 1000));   where.push(`"openTime" <= $${i++}`); }
    params.push(limit);
    return this.dataSource.query(`
      SELECT * FROM (
        SELECT "openTime","open","high","low","close","volume"
        FROM ${table} WHERE ${where.join(' AND ')}
        ORDER BY "openTime" DESC LIMIT $${i}
      ) sub ORDER BY "openTime" DESC`, params);
  }

  async getLatestPrice(marketId: number) {
    return this.dataSource.query(`
      SELECT close,"openTime" FROM aggregated_candles_1m
      WHERE "marketId" = $1 ORDER BY "openTime" DESC LIMIT 1`, [marketId]);
  }

  async get24hStats(marketId: number) {
    return this.dataSource.query(`
      SELECT
        first(open, "openTime") as open,
        last(close, "openTime") as close,
        max(high) as high, min(low) as low,
        sum("volumeUSDT") as "volumeUSDT",
        sum("baseVolume") as "baseVolume"
      FROM aggregated_candles_1m
      WHERE "marketId" = $1 AND "openTime" >= NOW() - INTERVAL '24 hours'`, [marketId]);
  }

  // ── NEW: MARKET LIST ─────────────────────────────────────────
  // Paginated list of all markets with price + 24h stats
  // Used by: GET /api/v1/markets/list
  async getMarketList(opts: {
    page:   number;
    limit:  number;
    sort:   string;
    order:  string;
    search?: string;
  }) {
    const { page, limit, sort, order, search } = opts;
    const offset = (page - 1) * limit;

    // Whitelist sort columns to prevent SQL injection
    const sortMap: Record<string, string> = {
      volume24hUsd: 'volume24h',
      price:        'last_price',
      change24h:    'change_pct',
      marketId:     'm.id',
    };
    const sortCol = sortMap[sort] ?? 'volume24h';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const searchClause = search ? `AND m.base ILIKE $3` : '';
    const params: any[] = [limit, offset];
    if (search) params.push(`${search}%`);

    const rows = await this.dataSource.query(`
      WITH stats AS (
        SELECT
          "marketId",
          first(open, "openTime")   AS open_price,
          last(close, "openTime")   AS last_price,
          max(high)                 AS high24h,
          min(low)                  AS low24h,
          sum("volumeUSDT")         AS volume24h,
          sum("baseVolume")         AS volume_base
        FROM aggregated_candles_1m
        WHERE "openTime" >= NOW() - INTERVAL '24 hours'
        GROUP BY "marketId"
      )
      SELECT
        m.id          AS "marketId",
        m.base        AS symbol,
        m.quote,
        m.symbol      AS pair,
        COALESCE(s.last_price, 0)::float  AS price,
        COALESCE(s.high24h, 0)::float     AS "high24h",
        COALESCE(s.low24h, 0)::float      AS "low24h",
        COALESCE(s.volume24h, 0)::float   AS "volume24hUsd",
        COALESCE(s.volume_base, 0)::float AS "volume24hBase",
        CASE WHEN s.open_price > 0
          THEN ROUND(((s.last_price - s.open_price) / s.open_price * 100)::numeric, 2)
          ELSE 0
        END::float  AS "change24h",
        (SELECT COUNT(*) FROM dex_pools p
          INNER JOIN tokens t ON (t.id = p."token0_id" OR t.id = p."token1_id")
          WHERE t."canonicalSymbol" = m.base AND p."isActive" = true
        )::int       AS "dexPoolCount",
        (SELECT COALESCE(SUM(p."liquidityUsd"), 0) FROM dex_pools p
          INNER JOIN tokens t ON (t.id = p."token0_id" OR t.id = p."token1_id")
          WHERE t."canonicalSymbol" = m.base AND p."isActive" = true
        )::float     AS "totalDexLiquidity"
      FROM markets m
      LEFT JOIN stats s ON s."marketId" = m.id
      WHERE 1=1 ${searchClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $1 OFFSET $2`, params);

    const [countRow] = await this.dataSource.query(`
      SELECT COUNT(*)::int AS total FROM markets m
      WHERE 1=1 ${search ? `AND m.base ILIKE $1` : ''}`,
      search ? [`${search}%`] : []);

    return {
      data:  rows,
      meta:  { total: countRow.total, page, limit, pages: Math.ceil(countRow.total / limit) },
    };
  }

  // ── NEW: EXTENDED STATS (7d + 30d) ───────────────────────────
  async getExtendedStats(marketId: number) {
    const [row] = await this.dataSource.query(`
      SELECT
        max(CASE WHEN "openTime" >= NOW() - INTERVAL '7 days'  THEN high END) AS "high7d",
        min(CASE WHEN "openTime" >= NOW() - INTERVAL '7 days'  THEN low  END) AS "low7d",
        max(CASE WHEN "openTime" >= NOW() - INTERVAL '30 days' THEN high END) AS "high30d",
        min(CASE WHEN "openTime" >= NOW() - INTERVAL '30 days' THEN low  END) AS "low30d",
        sum(CASE WHEN "openTime" >= NOW() - INTERVAL '7 days'  THEN "volumeUSDT" END) AS "volume7d",
        sum(CASE WHEN "openTime" >= NOW() - INTERVAL '30 days' THEN "volumeUSDT" END) AS "volume30d"
      FROM aggregated_candles_1m WHERE "marketId" = $1`, [marketId]);
    return row ?? {};
  }

  // ── NEW: DEX SUMMARY for a token ─────────────────────────────
  async getDexSummary(symbol: string) {
    const [row] = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT p.id)::int          AS "poolCount",
        COALESCE(SUM(p."liquidityUsd"), 0)::float AS "totalLiquidity",
        COALESCE(SUM(p."volume24h"), 0)::float    AS "volume24h"
      FROM dex_pools p
      INNER JOIN tokens t ON (t.id = p."token0_id" OR t.id = p."token1_id")
      WHERE t."canonicalSymbol" = $1 AND p."isActive" = true`, [symbol]);
    return row ?? { poolCount: 0, totalLiquidity: 0, volume24h: 0 };
  }

  // ── NEW: PER-EXCHANGE STATS ───────────────────────────────────
  // Reads from symbol_exchanges (populated by MarketDataSyncService)
  async getExchangeStats(symbol: string) {
    return this.dataSource.query(`
      SELECT
        se.exchange,
        sy.symbol                    AS pair,
        se."lastPrice"::float        AS price,
        se."priceChange24h"::float   AS "change24h",
        se."high24h"::float          AS "high24h",
        se."low24h"::float           AS "low24h",
        se."volume24hBase"::float    AS "volume24hBase",
        se."volume24hUsd"::float     AS "volume24hUsd",
        se."bidPrice"::float         AS bid,
        se."askPrice"::float         AS ask,
        se."spreadPct"::float        AS "spreadPct",
        se."depthBid2pct"::float     AS "depthBid2pct",
        se."depthAsk2pct"::float     AS "depthAsk2pct",
        se."updatedAt"               AS "updatedAt"
      FROM symbol_exchanges se
      INNER JOIN symbols sy ON sy.id = se."symbolId"
      WHERE sy.base = $1 AND se."isActive" = true AND se."lastPrice" IS NOT NULL
      ORDER BY se."volume24hUsd" DESC NULLS LAST`, [symbol]);
  }

  // ── NEW: DEX POOLS for a token ────────────────────────────────
  async getDexPools(opts: {
    symbol:       string;
    dex?:         string;
    chain?:       number;
    minLiquidity?: number;
    page?:         number;
    limit?:        number;
    sort?:         string;
  }) {
    const { symbol, dex, chain, minLiquidity, page=1, limit=20, sort ='ASC'} = opts;
    const offset = (page - 1) * limit;

    const sortMap: Record<string, string> = {
      liquidityUsd: 'p."liquidityUsd"',
      volume24h:    'p."volume24h"',
      price:        'p.price',
    };
    const sortCol = sortMap[sort] ?? 'p."liquidityUsd"';

    const params: any[] = [symbol, minLiquidity, limit, offset];
    const extra: string[] = [];
    if (dex)   { params.push(dex);   extra.push(`AND p.dex = $${params.length}`); }
    if (chain) { params.push(chain); extra.push(`AND p."chainId" = $${params.length}`); }

    const rows = await this.dataSource.query(`
      SELECT
        p.id,
        p."poolKey",
        p.dex,
        p."chainId",
        p.fee,
        p."tickSpacing",
        p."liquidityUsd"::float  AS "liquidityUsd",
        p."volume24h"::float     AS "volume24h",
        p.price::float           AS price,
        p."token0Balance"::float AS "token0Balance",
        p."token1Balance"::float AS "token1Balance",
        p."isActive",
        p."lastSwapAt",
        t0.symbol AS "token0Symbol",  t0."canonicalSymbol" AS "token0Canonical",
        t0.address AS "token0Address", t0.decimals AS "token0Decimals",
        t1.symbol AS "token1Symbol",  t1."canonicalSymbol" AS "token1Canonical",
        t1.address AS "token1Address", t1.decimals AS "token1Decimals"
      FROM dex_pools p
      INNER JOIN tokens t0 ON t0.id = p."token0_id"
      INNER JOIN tokens t1 ON t1.id = p."token1_id"
      WHERE (t0."canonicalSymbol" = $1 OR t1."canonicalSymbol" = $1)
        AND p."isActive" = true
        AND p."liquidityUsd" >= $2
        ${extra.join(' ')}
      ORDER BY ${sortCol} DESC NULLS LAST
      LIMIT $3 OFFSET $4`, params);

    const [{ total }] = await this.dataSource.query(`
      SELECT COUNT(*)::int AS total FROM dex_pools p
      INNER JOIN tokens t0 ON t0.id = p."token0_id"
      INNER JOIN tokens t1 ON t1.id = p."token1_id"
      WHERE (t0."canonicalSymbol" = $1 OR t1."canonicalSymbol" = $1)
        AND p."isActive" = true AND p."liquidityUsd" >= $2
        ${extra.join(' ')}`,
      params.slice(0, 2 + extra.length));

    return {
      data: rows.map(r => ({
        id:          r.id,
        poolKey:     r.poolKey,
        dex:         r.dex,
        chainId:     r.chainId,
        fee:         r.fee,
        tickSpacing: r.tickSpacing,
        liquidityUsd: r.liquidityUsd,
        volume24h:   r.volume24h,
        price:       r.price,
        isActive:    r.isActive,
        lastSwapAt:  r.lastSwapAt,
        token0: { symbol: r.token0Symbol, canonical: r.token0Canonical, address: r.token0Address, decimals: r.token0Decimals, balance: r.token0Balance },
        token1: { symbol: r.token1Symbol, canonical: r.token1Canonical, address: r.token1Address, decimals: r.token1Decimals, balance: r.token1Balance },
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ── NEW: ALL PAIRS (CEX + DEX combined) ──────────────────────
  async getAllPairs(opts: {
    symbol: string;
    type:   'all' | 'cex' | 'dex';
    page?:   number;
    limit?:  number;
  }) {
    const { symbol, type, page=1, limit = 20} = opts;
    const offset = (page - 1) * limit;
    const parts: string[] = [];

    if (type !== 'dex') {
      parts.push(`
        SELECT
          'CEX'                        AS source,
          se.exchange::text                 AS exchange,
          sy.symbol                    AS pair,
          se."lastPrice"::float        AS price,
          se."volume24hUsd"::float     AS volume24h,
          se."spreadPct"::float        AS spread,
          NULL::float                  AS liquidity,
          NULL::text                   AS dex,
          NULL::text                    AS "chainId",
          se."updatedAt"               AS "updatedAt"
        FROM symbol_exchanges se
        INNER JOIN symbols sy ON sy.id = se."symbolId"
        WHERE sy.base = '${symbol}' AND se."isActive" = true AND se."lastPrice" IS NOT NULL`);
    }

    if (type !== 'cex') {
      parts.push(`
        SELECT
          'DEX'                        AS source,
          p.dex::text                  AS exchange,
          t0.symbol || '/' || t1.symbol AS pair,
          p.price::float               AS price,
          p."volume24h"::float         AS volume24h,
          NULL::float                  AS spread,
          p."liquidityUsd"::float      AS liquidity,
          p.dex::text                  AS dex,
          p."chainId"::text                  AS "chainId",
          NULL::timestamptz            AS "updatedAt"
        FROM dex_pools p
        INNER JOIN tokens t0 ON t0.id = p."token0_id"
        INNER JOIN tokens t1 ON t1.id = p."token1_id"
        WHERE (t0."canonicalSymbol" = '${symbol}' OR t1."canonicalSymbol" = '${symbol}')
          AND p."isActive" = true`);
    }

    if (!parts.length) return { data: [], meta: { total: 0, page, limit, pages: 0 } };

    const combined = parts.join(' UNION ALL ');
    const rows  = await this.dataSource.query(
      `${combined} ORDER BY volume24h DESC NULLS LAST LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM (${combined}) sub`, []
    );

    return { data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  // ── NEW: POOL DETAIL ─────────────────────────────────────────
  async getPoolDetail(poolId: number) {
    const [pool] = await this.dataSource.query(`
      SELECT
        p.id, p."poolKey", p.dex, p."chainId", p.fee, p."tickSpacing", p.hooks,
        p."liquidityUsd"::float   AS "liquidityUsd",
        p."volume24h"::float      AS "volume24h",
        p.price::float            AS price,
        p."token0Balance"::float  AS "token0Balance",
        p."token1Balance"::float  AS "token1Balance",
        p."isActive", p."isInitialized", p."lastSwapAt", p.score::float AS score,
        t0.id AS "t0Id", t0.symbol AS "t0Symbol", t0."canonicalSymbol" AS "t0Canonical",
        t0.address AS "t0Address", t0.decimals AS "t0Decimals",
        t1.id AS "t1Id", t1.symbol AS "t1Symbol", t1."canonicalSymbol" AS "t1Canonical",
        t1.address AS "t1Address", t1.decimals AS "t1Decimals",
        (SELECT COUNT(*)::int FROM dex_market_maps WHERE "poolId" = p.id) AS "marketCount"
      FROM dex_pools p
      INNER JOIN tokens t0 ON t0.id = p."token0_id"
      INNER JOIN tokens t1 ON t1.id = p."token1_id"
      WHERE p.id = $1`, [poolId]);

    if (!pool) return null;

    const markets = await this.dataSource.query(`
      SELECT dmm."marketId", dmm."baseIsToken0", m.base, m.quote, m.symbol
      FROM dex_market_maps dmm
      INNER JOIN markets m ON m.id = dmm."marketId"
      WHERE dmm."poolId" = $1`, [poolId]);

    return {
      id:          pool.id,
      poolKey:     pool.poolKey,
      dex:         pool.dex,
      chainId:     pool.chainId,
      fee:         pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks:       pool.hooks,
      price:       pool.price,
      liquidityUsd:  pool.liquidityUsd,
      volume24h:     pool.volume24h,
      score:         pool.score,
      isActive:      pool.isActive,
      isInitialized: pool.isInitialized,
      lastSwapAt:    pool.lastSwapAt,
      token0: { id: pool.t0Id, symbol: pool.t0Symbol, canonical: pool.t0Canonical, address: pool.t0Address, decimals: pool.t0Decimals, balance: pool.token0Balance },
      token1: { id: pool.t1Id, symbol: pool.t1Symbol, canonical: pool.t1Canonical, address: pool.t1Address, decimals: pool.t1Decimals, balance: pool.token1Balance },
      markets,
    };
  }

  // ── NEW: TOP POOLS GLOBAL ────────────────────────────────────
  async getTopPools(opts: {
  dex?: string;
  chain?: number;
  minLiquidity?: number;
  page?: number;
  limit?: number;
  sort?: string;
}) {
  const {
    dex,
    chain,
    minLiquidity = 0,
    page = 1,
    limit = 100,
    sort = 'liquidityUsd',
  } = opts;

  const offset = (page - 1) * limit;

  const sortMap: Record<string, string> = {
    liquidityUsd: 'p."liquidityUsd"',
    volume24h: 'p."volume24h"',
    score: 'p.score',
  };

  const sortCol = sortMap[sort] ?? 'p."liquidityUsd"';

  // --------------------------
  // MAIN QUERY
  // --------------------------

  const params: any[] = [minLiquidity, limit, offset];
  const extra: string[] = [];

  if (dex) {
    params.push(dex);
    extra.push(`AND p.dex = $${params.length}`);
  }

  if (chain !== undefined) {
    params.push(chain);
    extra.push(`AND p."chainId" = $${params.length}`);
  }

  const rows = await this.dataSource.query(
    `
    SELECT
      p.id,
      p."poolKey",
      p.dex,
      p."chainId",
      p.fee,
      p."liquidityUsd"::float AS "liquidityUsd",
      p."volume24h"::float AS "volume24h",
      p.price::float AS price,
      p.score::float AS score,
      t0.symbol AS "token0Symbol",
      t0."canonicalSymbol" AS "token0Canonical",
      t1.symbol AS "token1Symbol",
      t1."canonicalSymbol" AS "token1Canonical"
    FROM dex_pools p
    INNER JOIN tokens t0 ON t0.id = p."token0_id"
    INNER JOIN tokens t1 ON t1.id = p."token1_id"
    WHERE p."isActive" = true
      AND p."liquidityUsd" >= $1
      ${extra.join(' ')}
    ORDER BY ${sortCol} DESC NULLS LAST
    LIMIT $2 OFFSET $3
    `,
    params,
  );

  // --------------------------
  // COUNT QUERY
  // --------------------------

  const countParams: any[] = [minLiquidity];
  const countExtra: string[] = [];

  if (dex) {
    countParams.push(dex);
    countExtra.push(`AND p.dex = $${countParams.length}`);
  }

  if (chain !== undefined) {
    countParams.push(chain);
    countExtra.push(`AND p."chainId" = $${countParams.length}`);
  }

  const [{ total }] = await this.dataSource.query(
    `
    SELECT COUNT(*)::int AS total
    FROM dex_pools p
    WHERE p."isActive" = true
      AND p."liquidityUsd" >= $1
      ${countExtra.join(' ')}
    `,
    countParams,
  );

  return {
    data: rows,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}
}











// @Injectable()
// export class MarketsRepository {

//   constructor(private readonly dataSource: DataSource) { }

//   async getMarkets(
//     marketId: number,
//     interval: string,
//     from?: number,
//     to?: number,
//     limit = 500,
//   ) {
//     console.log("interval", interval, marketId)
//     const table = intervalTable(interval);

//     const params: any[] = [marketId];
//     let whereClauses = ['"marketId" = $1']; // quote marketId just to be safe
//     let paramIndex = 2;

//     if (from) {
//       params.push(new Date(from * 1000));
//       whereClauses.push(`"openTime" >= $${paramIndex}`);
//       paramIndex++;
//     }

//     if (to) {
//       params.push(new Date(to * 1000));
//       whereClauses.push(`"openTime" <= $${paramIndex}`);
//       paramIndex++;
//     }

//     params.push(limit); // last param for LIMIT
//     const limitIndex = params.length;
//     console.log("parammm", params)
//     const query = `
//   SELECT *
//   FROM (
//     SELECT
//       "openTime",
//       "open",
//       "high",
//       "low",
//       "close",
//       "volume"
//     FROM ${table}
//     WHERE ${whereClauses.join(' AND ')}
//     ORDER BY "openTime" DESC
//     LIMIT $${limitIndex}
//   ) sub
//   ORDER BY "openTime" DESC
// `;

//     try {
//       const rows = await this.dataSource.query(query, params);
//       return rows;
//     } catch (err) {
//       console.error('Failed fetching candles:', err);
//       throw err;
//     }

//   }





//   async getLatestPrice(
//     marketId: number,

//   ) {
//     const rows = await this.dataSource.query(`
//       SELECT close,"openTime"
//       FROM aggregated_candles_1m
//       WHERE "marketId" = $1
//       ORDER BY "openTime" DESC
//       LIMIT 1
//     `, [marketId]);

//     return rows;
//   }




//   async get24hStats(
//     marketId: number
//   ) {

//     const row = await this.dataSource.query(`
//   SELECT
//     first(open, "openTime") as open,
//     last(close, "openTime") as close,
//     max(high) as high,
//     min(low) as low,
//     sum("volumeUSDT") as "volumeUSDT",
//     sum("baseVolume") as "baseVolume"
//   FROM aggregated_candles_1m
//   WHERE "marketId" = $1
//   AND "openTime" >= NOW() - INTERVAL '24 hours'
// `, [marketId]);


//     return row;


//   }
  
//   // // ── ON-DEMAND: get exchange stats for a single symbol ─────
//   // // Called by the API controller for /markets/:symbol/exchange-stats
//   // async getExchangeStats(symbolStr: string) {
//   //   const symbol = await this.symbolRepo.findOne({
//   //     where: { base: symbolStr },
//   //   });
//   //   if (!symbol) return [];

//   //   // Try Redis first (fast path)
//   //   const exchanges = [Exchange.BINANCE, Exchange.MEXC, Exchange.OKX];
//   //   const results = await Promise.all(
//   //     exchanges.map(async ex => {
//   //       const cached = await this.redis.get(
//   //         `exchange:ticker:${ex}:${symbol.symbol}`
//   //       );
//   //       if (cached) return { exchange: ex, ...JSON.parse(cached) };

//   //       // Redis miss — read from DB
//   //       const row = await this.seRepo.findOne({
//   //         where: { exchange: ex, symbol: { id: symbol.id } },
//   //         relations: ['symbol'],
//   //       });
//   //       if (!row || !row.lastPrice) return null;

//   //       return {
//   //         exchange: ex,
//   //         price: row.lastPrice,
//   //         change24h: row.priceChange24h,
//   //         high24h: row.high24h,
//   //         low24h: row.low24h,
//   //         volume24hBase: row.volume24hBase,
//   //         volume24hUsd: row.volume24hUsd,
//   //         bid: row.bidPrice,
//   //         ask: row.askPrice,
//   //         spread: row.spreadPct,
//   //         depthBid2pct: row.depthBid2pct,
//   //         depthAsk2pct: row.depthAsk2pct,
//   //         updatedAt: row.updatedAt,
//   //       };
//   //     })
//   //   );

//   //   return results.filter(Boolean);
//   // }



// }
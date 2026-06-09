// src/ingestion/onchain/providers/subgraph.client.ts
//
// Fetches pool-level USD liquidity + 24h volume from the Uniswap V3 subgraph
// (The Graph). This is how we get REAL USD liquidity values — not the raw
// uint128 tick liquidity from liquidity().
//
// Subgraph endpoint (free, no API key):
//   https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3
//
// Set in .env:
//   UNISWAP_SUBGRAPH=https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface SubgraphPoolData {
  poolKey: string;
  totalValueLockedUSD: number;
  volumeUSD24h: number;
  token0Price: number; // token1 per token0
  token1Price: number; // token0 per token1
}

const POOL_QUERY = `
  query GetPools($ids: [String!]!) {
    pools(where: { id_in: $ids }) {
      id
      totalValueLockedUSD
      volumeUSD
      poolDayData(first: 1, orderBy: date, orderDirection: desc) {
        volumeUSD
        tvlUSD
      }
      token0Price
      token1Price
    }
  }
`;

// For initial discovery: top pools by TVL for a token pair
const TOP_POOLS_QUERY = `
  query TopPools($token0: String!, $token1: String!, $limit: Int!) {
    pools(
      where: { token0: $token0, token1: $token1 }
      orderBy: totalValueLockedUSD
      orderDirection: desc
      first: $limit
    ) {
      id
      feeTier
      totalValueLockedUSD
      token0 { id symbol decimals }
      token1 { id symbol decimals }
      token0Price
      token1Price
    }
  }
`;

@Injectable()
export class SubgraphClient {
  private readonly logger = new Logger(SubgraphClient.name);
  private readonly endpoint: string;

  constructor() {
    this.endpoint =
      process.env.UNISWAP_SUBGRAPH ||
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';
  }

  /**
   * Fetch USD liquidity + 24h volume for a batch of pool addresses.
   * Batches up to 100 pools per request (subgraph limit).
   */
  async getPoolsData(poolKeyes: string[]): Promise<Map<string, SubgraphPoolData>> {
    const result = new Map<string, SubgraphPoolData>();
    if (poolKeyes.length === 0) return result;

    // Subgraph uses lowercase addresses
    const ids = poolKeyes.map((a) => a.toLowerCase());

    // Batch in chunks of 100
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const response = await axios.post<{ data: { pools: any[] } }>(
          this.endpoint,
          { query: POOL_QUERY, variables: { ids: chunk } },
          { timeout: 10_000 },
        );

        const pools = response.data?.data?.pools ?? [];
        for (const p of pools) {
          const dayData = p.poolDayData?.[0];
          result.set(p.id.toLowerCase(), {
            poolKey: p.id,
            totalValueLockedUSD: parseFloat(p.totalValueLockedUSD || '0'),
            volumeUSD24h: parseFloat(dayData?.volumeUSD || '0'),
            token0Price: parseFloat(p.token0Price || '0'),
            token1Price: parseFloat(p.token1Price || '0'),
          });
        }
      } catch (err) {
        this.logger.error(`Subgraph batch fetch failed (chunk ${i}):`, err?.message);
      }
    }

    return result;
  }

  /**
   * Discover top pools for a token pair from the subgraph.
   * Used as an alternative to O(n²) on-chain getPool() calls.
   * Returns top `limit` pools sorted by TVL desc.
   */
  async getTopPoolsForPair(
    token0Address: string,
    token1Address: string,
    limit = 3,
  ): Promise<Array<{
    poolKey: string;
    fee: number;
    tvlUSD: number;
    token0: { address: string; symbol: string; decimals: number };
    token1: { address: string; symbol: string; decimals: number };
  }>> {
    try {
      // Try both orderings (subgraph always stores token0 < token1 by address)
      const [t0, t1] = [token0Address.toLowerCase(), token1Address.toLowerCase()].sort();

      const response = await axios.post(
        this.endpoint,
        {
          query: TOP_POOLS_QUERY,
          variables: { token0: t0, token1: t1, limit },
        },
        { timeout: 10_000 },
      );

      const pools = response.data?.data?.pools ?? [];
      return pools.map((p: any) => ({
        poolKey: p.id,
        fee: parseInt(p.feeTier),
        tvlUSD: parseFloat(p.totalValueLockedUSD || '0'),
        token0: {
          address: p.token0.id,
          symbol: p.token0.symbol,
          decimals: parseInt(p.token0.decimals),
        },
        token1: {
          address: p.token1.id,
          symbol: p.token1.symbol,
          decimals: parseInt(p.token1.decimals),
        },
      }));
    } catch (err) {
      this.logger.error(`Subgraph top pools fetch failed:`, err?.message);
      return [];
    }
  }

  /**
   * Get all active pools for a list of token addresses.
   * Used in pool discovery cron to find new pools for known tokens.
   */
  async getPoolsForTokens(
    tokenAddresses: string[],
    minTvlUsd = 10_000,
    limit = 200,
  ): Promise<Array<{
    poolKey: string;
    fee: number;
    tvlUSD: number;
    token0: { address: string; symbol: string; decimals: number };
    token1: { address: string; symbol: string; decimals: number };
  }>> {
    const QUERY = `
      query PoolsForTokens($tokens: [String!]!, $minTvl: BigDecimal!, $limit: Int!) {
        pools(
          where: {
            token0_in: $tokens
            totalValueLockedUSD_gt: $minTvl
          }
          orderBy: totalValueLockedUSD
          orderDirection: desc
          first: $limit
        ) {
          id
          feeTier
          totalValueLockedUSD
          token0 { id symbol decimals }
          token1 { id symbol decimals }
        }
      }
    `;

    try {
      const lowerAddresses = tokenAddresses.map((a) => a.toLowerCase());
      const response = await axios.post(
        this.endpoint,
        {
          query: QUERY,
          variables: { tokens: lowerAddresses, minTvl: minTvlUsd, limit },
        },
        { timeout: 15_000 },
      );

      const pools = response.data?.data?.pools ?? [];
      return pools.map((p: any) => ({
        poolKey: p.id,
        fee: parseInt(p.feeTier),
        tvlUSD: parseFloat(p.totalValueLockedUSD || '0'),
        token0: {
          address: p.token0.id,
          symbol: p.token0.symbol,
          decimals: parseInt(p.token0.decimals),
        },
        token1: {
          address: p.token1.id,
          symbol: p.token1.symbol,
          decimals: parseInt(p.token1.decimals),
        },
      }));
    } catch (err) {
      this.logger.error(`Subgraph pools-for-tokens fetch failed:`, err?.message);
      return [];
    }
  }
}
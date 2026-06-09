// ============================================================
// markets.controller.ts
// Flow: Controller → Service → Repository
// Controller never imports or calls Repository directly.
// ============================================================
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Post,
  Body,
} from '@nestjs/common';
import { MarketsQueryDto } from './dto/markets-query.dto';
import { MarketDataService } from '@/market-data/market-data.service';
import { MarketsService } from './markets.service';

@Controller('api/v1/markets')
export class MarketsController {

  constructor(
    private readonly marketsService:    MarketsService,
    private readonly marketDataService: MarketDataService,
  ) {}

  // ── EXISTING ─────────────────────────────────────────────────

  @Get()
  async getCandles(@Query() query: MarketsQueryDto) {
    const market = await this.marketDataService.findBySymbol(query.symbol);
    if (!market) throw new NotFoundException('Symbol not found');

    const candles = await this.marketsService.getMarkets(
      market.id, query.interval, query.from, query.to, query.limit,
    );
    return { s: 'ok', data: candles };
  }

  @Get(':symbol/price')
  async getPrice(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const { time, price } = await this.marketsService.getLatestPrice(market.id);
    return { symbol, price, time };
  }

  @Get(':symbol/stats')
  async get24hStats(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const stats = await this.marketsService.get24hStats(market.id);
    return { symbol, ...stats };
  }

  // ── NEW ───────────────────────────────────────────────────────

  // GET /api/v1/markets/list?page=1&limit=100&sort=volume24hUsd&order=desc&search=BTC
  @Get('list')
  async getMarketList(
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(100),  ParseIntPipe) limit: number,
    @Query('sort',  new DefaultValuePipe('volume24hUsd')) sort: string,
    @Query('order', new DefaultValuePipe('desc')) order: string,
    @Query('search') search?: string,
  ) {
    const result = await this.marketsService.getMarketList({ page, limit, sort, order, search });
    return { s: 'ok', ...result };
  }

  // GET /api/v1/markets/pools?dex=UNISWAP_V3&chain=1&limit=100
  @Get('pools')
  async getTopPools(
    @Query('dex')   dex?:   string,
    @Query('chain') chain?: string,
    @Query('minLiquidity', new DefaultValuePipe(10000), ParseIntPipe) minLiquidity?: number,
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page?:  number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
    @Query('sort',  new DefaultValuePipe('liquidityUsd')) sort?: string,
  ) {
    const result = await this.marketsService.getTopPools({
      dex, chain: chain ? Number(chain) : undefined, minLiquidity, page, limit, sort,
    });
    return { s: 'ok', ...result };
  }

  // GET /api/v1/markets/pools/:poolId
  @Get('pools/:poolId')
  async getPoolDetail(@Param('poolId', ParseIntPipe) poolId: number) {
    const pool = await this.marketsService.getPoolDetail(poolId);
    if (!pool) throw new NotFoundException('Pool not found');
    return pool;
  }

  // GET /api/v1/markets/:symbol/overview
  @Get(':symbol/overview')
  async getTokenOverview(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    return this.marketsService.getTokenOverview(market.id, symbol);
  }

  // GET /api/v1/markets/:symbol/exchanges
  @Get(':symbol/exchanges')
  async getExchangeStats(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const exchanges = await this.marketsService.getExchangeStats(symbol);
    return { symbol, exchanges };
  }

  // GET /api/v1/markets/:symbol/pools?dex=UNISWAP_V3&chain=1&minLiquidity=1000
  @Get(':symbol/pools')
  async getTokenPools(
    @Param('symbol') symbol: string,
    @Query('dex')    dex?:   string,
    @Query('chain')  chain?: number,
    @Query('minLiquidity', new DefaultValuePipe(1000),  ParseIntPipe) minLiquidity?: number,
    @Query('page',         new DefaultValuePipe(1),     ParseIntPipe) page?:         number,
    @Query('limit',        new DefaultValuePipe(50),    ParseIntPipe) limit?:        number,
    @Query('sort',         new DefaultValuePipe('liquidityUsd')) sort?: string,
  ) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const result = await this.marketsService.getDexPools({ symbol, dex, chain, minLiquidity, page, limit, sort });
    return { symbol, ...result };
  }

  // GET /api/v1/markets/:symbol/pairs?type=all|cex|dex
  @Get(':symbol/pairs')
  async getAllPairs(
    @Param('symbol') symbol: string,
    @Query('type',  new DefaultValuePipe('all'))  type:  'all' | 'cex' | 'dex',
    @Query('page',  new DefaultValuePipe(1),   ParseIntPipe) page?:  number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const result = await this.marketsService.getAllPairs({ symbol, type, page, limit });
    return { symbol, ...result };
  }





  // ─────────────────────────────────────────────────────────────
  // TOKEN METADATA  (new — same flow, just another service method)
  // ─────────────────────────────────────────────────────────────
 
  // GET /api/v1/markets/:symbol/metadata
  // Returns static token info: supply, FDV, ATH/ATL, contracts,
  // socials, website, whitepaper, description — everything on CMC token page
  @Get(':symbol/metadata')
  async getTokenMetadata(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    return this.marketsService.getTokenMetadata(market.id, symbol);
  }
 
  // POST /api/v1/markets/:symbol/metadata/seed
  // Fetch metadata from CoinGecko and store it for this token
  @Post(':symbol/metadata/seed')
  async seedTokenMetadata(@Param('symbol') symbol: string) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    const seeded = await this.marketsService.seedTokenMetadata(symbol);
    return { symbol, seeded };
  }
 
  // PUT /api/v1/markets/:symbol/metadata
  // Manually update/override metadata fields
  @Post(':symbol/metadata')
  async updateTokenMetadata(
    @Param('symbol') symbol: string,
    @Body() body: Record<string, any>,
  ) {
    const market = await this.marketDataService.findBySymbol(symbol);
    if (!market) throw new NotFoundException('Symbol not found');
    return this.marketsService.upsertTokenMetadata(market.id, body);
  }

 
}
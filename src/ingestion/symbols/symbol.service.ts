import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SymbolEntity } from './entities/symbol.entity';
import { SymbolExchangeEntity } from './entities/symbol-exchange.entity';
import { Exchange } from '@/common/enums/exchanges.enums';
import { DataSource, Repository } from 'typeorm';
import { MarketEntity } from '@/market-data/market.entity';
import chunk from 'lodash.chunk';
import { FxRateEntity } from './entities/fx-rate.entity';
import axios from 'axios';
import { Cron } from '@nestjs/schedule';
import { updateFiatRates } from '@/common/utils/fx-engine.util';

@Injectable()
export class SymbolsService {
  private readonly logger = new Logger(SymbolsService.name);
  private rates: Map<string, number> = new Map();

  constructor(
    
    private readonly dataSource: DataSource,
    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    @InjectRepository(SymbolExchangeEntity)
    private readonly symbolExchangeRepo: Repository<SymbolExchangeEntity>,
    @InjectRepository(FxRateEntity)
    private readonly fxRepo: Repository<FxRateEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRep: Repository<MarketEntity>,

  ) {
    // this.rates.set('USD', 1);

  }

  /**
   * Smart insert or update symbols for an exchange
   */

  // async upsertSymbols(
  //   exchange: Exchange,
  //   symbols: { symbol: string; base: string; quote: string }[],
  // ) {
  //   console.log("eexhnage",exchange)
  //   for (const [index, s] of symbols.entries()) {
  //     const symbolEntity = await this.symbolRepo.findOne({
  //       where: { symbol: s.symbol, base: s.base, quote: s.quote },
  //     });
  
  //     const finalSymbol =
  //       symbolEntity ??
  //       (await this.symbolRepo.save(
  //         this.symbolRepo.create(s),
  //       ));
  
  //     try {
  //               console.log("err1",index)

  //       await this.symbolExchangeRepo.insert({
  //         exchange,
  //         symbol: finalSymbol,
  //       });
  //     } catch (err) {
  //       console.log("err")
  //       // Ignore duplicate (exchange, symbol)
  //       if (err.code !== '23505') throw err;
  //     }
  //   }
  // }
  normalizeQuote(quote: string) {
    const stableCoins = ['USDT', 'USDC', 'BUSD', 'TUSD'];
  
    if (stableCoins.includes(quote)) return 'USD';
  
    return quote;
  }

  async syncExchangeSymbols(
    exchange: Exchange,
    symbols: { symbol: string; base: string; quote: string }[],
  ) {
    console.log("length",symbols.length,exchange)
    if (!symbols.length) return;
    console.log("length", symbols.length, exchange);
  
    const CHUNK_SIZE = 500; // smaller chunks reduce deadlocks
  
    // Deduplicate symbols by symbol-base-quote
    const dedupedSymbols = Array.from(
      new Map(symbols.map(s => [`${s.symbol}-${s.base}-${s.quote}`, s])).values()
    );
  
    for (let i = 0; i < dedupedSymbols.length; i += CHUNK_SIZE) {
      const chunk = dedupedSymbols.slice(i, i + CHUNK_SIZE);
  
      try {
        await this.dataSource.transaction(async manager => {
          const marketRepo = manager.getRepository(MarketEntity);
          const symbolRepo = manager.getRepository(SymbolEntity);
          const symbolExchangeRepo = manager.getRepository(SymbolExchangeEntity);
  
          // 1️⃣ Normalize markets
          const markets = Array.from(
            new Map(
              chunk.map(s => [`${s.base}-USD`, { base: s.base, quote: 'USD', symbol: `${s.base}-USD` }])
            ).values()
          );
  
          // 2️⃣ Upsert markets
          await marketRepo.upsert(markets, { conflictPaths: ['base', 'quote'] });
  
          // 3️⃣ Fetch saved markets
          const savedMarkets = await marketRepo.find({
            where: markets.map(m => ({ base: m.base, quote: m.quote })),
          });
          const marketMap = new Map(savedMarkets.map(m => [`${m.base}-USD`, m]));
  
          // 4️⃣ Prepare symbols
          const symbolRows = chunk.map(s => ({
            symbol: s.symbol,
            base: s.base,
            quote: s.quote,
            market: marketMap.get(`${s.base}-USD`),
          }));
  
          // Deduplicate symbolRows by symbol-base-quote before upsert
          const dedupSymbolRows = Array.from(
            new Map(symbolRows.map(r => [`${r.symbol}-${r.base}-${r.quote}`, r])).values()
          );
  
          // 5️⃣ Upsert symbols
          await symbolRepo.upsert(dedupSymbolRows, {
            conflictPaths: ['symbol', 'base', 'quote'],
          });
  
          const savedSymbols = await symbolRepo.find({
            where: dedupSymbolRows.map(s => ({ symbol: s.symbol, base: s.base, quote: s.quote })),
          });
  
          // 6️⃣ Create exchange mappings
          const uniqueSymbols = Array.from(
            new Map(savedSymbols.map(s => [`${exchange}:${s.id}`, s])).values()
          );
  
          await symbolExchangeRepo
            .createQueryBuilder()
            .insert()
            .values(uniqueSymbols.map(sym => ({ exchange, symbol: sym })))
            .orIgnore()
            .execute();
        });
      } catch (err) {
        this.logger.error(`Failed syncing chunk for ${exchange}`, err);
      }
    }
  }
 

 
//2ndfinale

// async syncExchangeSymbols(
//   exchange: Exchange,
//   symbols: { symbol: string; base: string; quote: string }[],
// ) {
//   if (!symbols.length) return;

//   const CHUNK_SIZE = 500; // avoid deadlocks & ON CONFLICT issues
//   for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
//     const chunk = symbols.slice(i, i + CHUNK_SIZE);

//     try {
//       await this.dataSource.transaction(async manager => {
//         const marketRepo = manager.getRepository(MarketEntity);
//         const symbolRepo = manager.getRepository(SymbolEntity);
//         const symbolExchangeRepo = manager.getRepository(SymbolExchangeEntity);

//         // 1️⃣ Normalize markets
//         const markets = chunk.map(s => ({
//           base: s.base,
//           quote: s.quote,
//           symbol: `${s.base}-${s.quote}`,
//         }));

//         // 2️⃣ Upsert markets
//         await marketRepo.upsert(markets, { conflictPaths: ['base', 'quote'] });

//         // 3️⃣ Fetch saved markets
//         const savedMarkets = await marketRepo.find({
//           where: markets.map(m => ({ base: m.base, quote: m.quote })),
//         });
//         const marketMap = new Map(savedMarkets.map(m => [`${m.base}-${m.quote}`, m]));

//         // 4️⃣ Build symbol rows
//         const symbolRows = chunk.map(s => ({
//           symbol: s.symbol,
//           base: s.base,
//           quote: s.quote,
//           market: marketMap.get(`${s.base}-${s.quote}`),
//         }));

//         // 5️⃣ Upsert symbols
//         await symbolRepo.upsert(symbolRows, {
//           conflictPaths: ['symbol', 'base', 'quote'],
//         });

//         // 6️⃣ Fetch saved symbols
//         const savedSymbols = await symbolRepo.find({
//           where: chunk.map(s => ({
//             symbol: s.symbol,
//             base: s.base,
//             quote: s.quote,
//           })),
//         });

//         // 7️⃣ Upsert exchange mappings
//         await symbolExchangeRepo
//           .createQueryBuilder()
//           .insert()
//           .values(
//             savedSymbols.map(sym => ({ exchange, symbol: sym }))
//           )
//           .orIgnore()
//           .execute();
//       });
//     } catch (err) {
//       this.logger.error(`Failed syncing chunk ${i / CHUNK_SIZE + 1}`, err);
//     }
//   }
// }



  // async upsertSymbols(
  //   exchange: Exchange,
  //   symbols: { symbol: string; base: string; quote: string }[],
  // ) {
  //   if (!symbols.length) return;
  
  //   await this.dataSource.transaction(async manager => {
  //     const symbolRepo = manager.getRepository(SymbolEntity);
  //     const symbolExchangeRepo = manager.getRepository(SymbolExchangeEntity);
  
  //     // 1️⃣ Bulk UPSERT symbols
  //     await symbolRepo.upsert(symbols, {
  //       conflictPaths: ['symbol', 'base', 'quote'],
  //     });
  
  //     // 2️⃣ Fetch symbol IDs efficiently (IMPORTANT)
  //     const keys = symbols.map(
  //       s => `${s.symbol}:${s.base}:${s.quote}`,
  //     );
  
  //     const savedSymbols = await symbolRepo
  //       .createQueryBuilder('s')
  //       .where(
  //         "concat(s.symbol, ':', s.base, ':', s.quote) IN (:...keys)",
  //         { keys },
  //       )
  //       .getMany();
  
  //     // 3️⃣ Bulk insert exchange mappings
  //     await symbolExchangeRepo
  //       .createQueryBuilder()
  //       .insert()
  //       .values(
  //         savedSymbols.map(sym => ({
  //           exchange,
  //           symbol: { id: sym.id },
  //           listedAt: new Date(),
  //           isActive: true,
  //         })),
  //       )
  //       .orIgnore()
  //       .execute();
  //   });
  // }
  
  async getAllSymbols() {
    return this.symbolRepo.find();
  }
 
    
  async markets() {
    return await this.marketRep.find();

  }




  async getExchangesForSymbol(symbolId: number) {
    return this.symbolExchangeRepo.find({
      where: {
        symbol: { id: symbolId },
        // isActive: true,
      },
    });
  }
  






  async getSymbolsByExchange(exchange: Exchange) {
    return this.symbolExchangeRepo.find({
      where: { exchange },
      relations: ['symbol'],
    });
  }














  async refreshRates() {
    try {
      const res = await axios.get(
        'https://api.frankfurter.app/latest?from=USD'
      );
  
      const rates = res.data.rates;
  
      // ✅ update FX engine ONCE
      updateFiatRates(rates);
  
      // ✅ store in DB (correct direction)
      for (const [currency, rate] of Object.entries(rates)) {
        if (!rate || Number(rate) <= 0) continue;
  
        await this.fxRepo.upsert(
          {
            currency,
            rateToUSD: 1 / Number(rate), // 🔥 FIXED
            lastUpdated: new Date(),
          },
          ['currency'],
        );
      }
  
    } catch (err) {
      console.error('Failed fetching FX rates', err);
  
      // 🔥 fallback to DB
      // await this.loadRatesFromDB();
    }
  }

  async loadRatesFromDB() {
    const rows = await this.fxRepo.find();
  
    const rates: Record<string, number> = {};
  
    for (const r of rows) {
      if (!r.rateToUSD || r.rateToUSD <= 0) continue;
  
      // convert back to Frankfurter format (USD → currency)
      rates[r.currency] = 1 / Number(r.rateToUSD);
    }
  
updateFiatRates(rates);
  
    console.log('✅ FX loaded from DB fallback');
  }


  
  getRate(currency: string): number {
    if (currency === 'USD') return 1;
  
    const rate = this.rates.get(currency);
  
    if (!rate || rate <= 0) return 0;
  
    // 🔥 IMPORTANT: invert rate
    return 1 / rate;
  }

  @Cron('*/1 * * * *')
  async updateFxRates() {
   await this.refreshRates(); // implement fetch from API
  }
 



}

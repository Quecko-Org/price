import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SymbolEntity } from './entities/symbol.entity';
import { SymbolExchangeEntity } from './entities/symbol-exchange.entity';
import { Exchange } from '@/common/enums/exchanges.enums';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class SymbolsService {
  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    @InjectRepository(SymbolExchangeEntity)
    private readonly symbolExchangeRepo: Repository<SymbolExchangeEntity>,
  ) {}

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


  async upsertSymbols(
    exchange: Exchange,
    symbols: { symbol: string; base: string; quote: string }[],
  ) {
    if (!symbols.length) return;

    await this.dataSource.transaction(async manager => {
      const symbolRepo = manager.getRepository(SymbolEntity);
      const symbolExchangeRepo = manager.getRepository(SymbolExchangeEntity);

      // 1️⃣ Bulk UPSERT symbols (insert if missing, do nothing if exists)
    let s=  await symbolRepo.upsert(symbols, {
        conflictPaths: ['symbol', 'base', 'quote'],
      });
      // console.log(s)

      // 2️⃣ Fetch all symbols (now guaranteed to exist)
      const savedSymbols = await symbolRepo.find({
        where: symbols.map(s => ({
          symbol: s.symbol,
          base: s.base,
          quote: s.quote,
        })),
      });

      // 3️⃣ Bulk insert exchange ↔ symbol relations (ignore duplicates)
   let fs =  
    await symbolExchangeRepo
        .createQueryBuilder()
        .insert()
        .values(
          savedSymbols.map(sym => ({
            exchange,
            symbol: sym,
          }))
        )
        .orIgnore()
        .execute();
        console.log(fs)

    });
  }



  // async upsertSymbols(
  //   exchange: Exchange,
  //   symbols: { symbol: string; base: string; quote: string }[],
  // ) {
  //   if (!symbols.length) return;

  //   await this.dataSource.transaction(async manager => {
  //     const symbolRepo = manager.getRepository(SymbolEntity);
  //     const symbolExchangeRepo = manager.getRepository(SymbolExchangeEntity);

  //     await symbolRepo.upsert(symbols, {
  //       conflictPaths: ['symbol', 'base', 'quote'],
  //     });

  //     const keys = symbols.map(s => `${s.symbol}:${s.base}:${s.quote}`);

  //     const savedSymbols = await symbolRepo
  //       .createQueryBuilder('s')
  //       .where(
  //         "concat(s.symbol, ':', s.base, ':', s.quote) IN (:...keys)",
  //         { keys },
  //       )
  //       .getMany();

  //     await symbolExchangeRepo
  //       .createQueryBuilder()
  //       .insert()
  //       .values(
  //         savedSymbols.map(sym => ({
  //           exchange,
  //           symbol: { id: sym.id },
  //           isActive: true,
  //         })),
  //       )
  //       .orIgnore()
  //       .execute();
  //   });
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






}

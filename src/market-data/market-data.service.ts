import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Exchange } from "@/common/enums/exchanges.enums";
import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
import { BinanceWebSocket } from "@/ingestion/exchanges/binance/binance.ws";
import { MexcWebSocket } from "@/ingestion/exchanges/mexc/mexc.ws";
import { MarketEntity } from "./market.entity";

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    @InjectRepository(MarketEntity)
        private readonly marketRepo: Repository<MarketEntity>,
    private readonly binanceWs: BinanceWebSocket,
    private readonly mexcWs: MexcWebSocket,
  ) {}

  async onModuleInit() {

    this.logger.log("Starting market WS engine");

    const symbols = await this.symbolRepo.find({
      relations: ["exchanges", "market"],
    });

    const symbolMarketMap: Record<string, number> = {};
    const symbolMetaMap: Record<string, { base: string; quote: string }> = {};

    for (const s of symbols) {
      for (const ex of s.exchanges) {

        const key = `${ex.exchange}:${s.symbol.toUpperCase()}`;

        symbolMarketMap[key] = s.market.id;

        symbolMetaMap[key] = {
          base: s.base,
          quote: s.quote,
        };
      }
    }

    /*
    ==========================
    BINANCE SHARDING
    ==========================
    */

    const binanceSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
      .map(s => s.symbol);

    const BINANCE_CHUNK = 180;

    for (let i = 0; i < binanceSymbols.length; i += BINANCE_CHUNK) {

      const chunk = binanceSymbols.slice(i, i + BINANCE_CHUNK);

      this.logger.log(`Launching Binance WS (${chunk.length} symbols)`);

      this.binanceWs.connect(chunk, symbolMarketMap, symbolMetaMap);
    }

    /*
    ==========================
    MEXC SHARDING
    ==========================
    */

    const mexcSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
      .map(s => s.symbol);

    const MEXC_CHUNK = 25;

    for (let i = 0; i < mexcSymbols.length; i += MEXC_CHUNK) {

      const chunk = mexcSymbols.slice(i, i + MEXC_CHUNK);

      this.logger.log(`Launching MEXC WS (${chunk.length} symbols)`);

      this.mexcWs.connect(chunk, symbolMarketMap, symbolMetaMap);
    }
  }


  async findBySymbol(symbol: string) {

        return this.marketRepo.findOne({
          where: {
            base: 'BTC',
          },
        });
      }
}



// import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { Exchange } from "@/common/enums/exchanges.enums";
// import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
// import { BinanceWebSocket } from "@/ingestion/exchanges/binance/binance.ws";
// import { MexcWebSocket } from "@/ingestion/exchanges/mexc/mexc.ws";
// import { MarketEntity } from "./market.entity";

// @Injectable()
// export class MarketDataService implements OnModuleInit {
//   private readonly logger = new Logger(MarketDataService.name);

//   constructor(
//     @InjectRepository(SymbolEntity)
//     private readonly symbolRepo: Repository<SymbolEntity>,
//         @InjectRepository(MarketEntity)
//     private readonly marketRepo: Repository<MarketEntity>,
//     private readonly binanceWs: BinanceWebSocket,
//     private readonly mexcWs: MexcWebSocket,
//   ) {}

//   async onModuleInit() {
//     this.logger.log('Starting canonical market engine…');

//     const symbols = await this.symbolRepo.find({
//       relations: ['exchanges', 'market'],
//     });

//     /**
//      * Map:
//      * BINANCE:ETHUSDT → marketId
//      * MEXC:ETHUSDT → marketId
//      */


    
//     const symbolMarketMap: Record<string, number> = {};
//     const symbolMetaMap: Record<string, { base: string; quote: string }> = {};

//     for (const s of symbols) {
//       for (const ex of s.exchanges) {
//         const key = `${ex.exchange}:${s.symbol.toUpperCase()}`;
//         symbolMarketMap[key] = s.market.id;
//         symbolMetaMap[key] = {
//           base: s.base,
//           quote: s.quote,
//         };
//       }
//     }

//     // Sharding Binance (max 200 symbols per WS)
//     const binanceSymbols = symbols
//       .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
//       .map(s => s.symbol);

//     const BINANCE_CHUNK = 200;
//     for (let i = 0; i < binanceSymbols.length; i += BINANCE_CHUNK) {
//       const chunk = binanceSymbols.slice(i, i + BINANCE_CHUNK);
//       this.logger.log(`Binance WS symbols: ${chunk.length}`);
//       this.binanceWs.connect(chunk, symbolMarketMap,symbolMetaMap);
//     }

//     // Sharding MEXC (max 100 symbols per WS)
//     const mexcSymbols = symbols
//       .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
//       .map(s => s.symbol);

//     const MEXC_CHUNK = 100;
//     for (let i = 0; i < mexcSymbols.length; i += MEXC_CHUNK) {
//       const chunk = mexcSymbols.slice(i, i + MEXC_CHUNK);
//       this.logger.log(`MEXC WS symbols: ${chunk.length}`);
//       this.mexcWs.connect(chunk, symbolMarketMap,symbolMetaMap);
//     }
//   }


//   async findBySymbol(symbol: string) {

//     return this.marketRepo.findOne({
//       where: {
//         base: 'BTC',
//       },
//     });
//   }
// }






// import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { Exchange } from "@/common/enums/exchanges.enums";
// import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
// import { BinanceWebSocket } from "@/ingestion/exchanges/binance/binance.ws";
// import { MexcWebSocket } from "@/ingestion/exchanges/mexc/mexc.ws";
// import { MarketEntity } from "./market.entity";

// @Injectable()
// export class MarketDataService implements OnModuleInit {
//   private readonly logger = new Logger(MarketDataService.name);

//   constructor(
//     @InjectRepository(SymbolEntity)
//     private readonly symbolRepo: Repository<SymbolEntity>,

//     @InjectRepository(MarketEntity)
//     private readonly marketRepo: Repository<MarketEntity>,
//     private readonly binanceWs: BinanceWebSocket,
//     private readonly mexcWs: MexcWebSocket,
//   ) {}

//   async onModuleInit() {
//     this.logger.log('Starting canonical market engine…');

//     const symbols = await this.symbolRepo.find({
//       relations: ['exchanges', 'market'],
//     });

//     /**
//      * Map:
//      * BINANCE:ETHUSDT → marketId
//      * MEXC:ETHUSDT → marketId
//      */

//     const canonicalMarketId = 6262; // BTC-USD market


//     const symbolMarketMap: Record<string, number> = {};
//     const symbolMetaMap: Record<string, { base: string; quote: string }> = {};
//     const canonicalSymbols = symbols.filter(s =>
//       s.market.id === canonicalMarketId
//     );
//     for (const s of canonicalSymbols) {
//       for (const ex of s.exchanges) {
//         const key = `${ex.exchange}:${s.symbol.toUpperCase()}`;
//         symbolMarketMap[key] = s.market.id;
//         symbolMetaMap[key] = {
//           base: s.base,
//           quote: s.quote,
//         };
//       }
//     }

//     // Sharding Binance (max 200 symbols per WS)
//     const binanceSymbols = canonicalSymbols
//       .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
//       .map(s => s.symbol);

//     const BINANCE_CHUNK = 200;
//     for (let i = 0; i < binanceSymbols.length; i += BINANCE_CHUNK) {
//       const chunk = binanceSymbols.slice(i, i + BINANCE_CHUNK);
//       this.logger.log(`Binance WS symbols: ${chunk.length}`);
//       this.binanceWs.connect(chunk, symbolMarketMap,symbolMetaMap);
//     }

//     // Sharding MEXC (max 100 symbols per WS)
//     const mexcSymbols = canonicalSymbols
//       .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
//       .map(s => s.symbol);

//     const MEXC_CHUNK = 100;
//     for (let i = 0; i < mexcSymbols.length; i += MEXC_CHUNK) {
//       const chunk = mexcSymbols.slice(i, i + MEXC_CHUNK);
//       this.logger.log(`MEXC WS symbols: ${chunk.length}`);
//       this.mexcWs.connect(chunk, symbolMarketMap,symbolMetaMap);
//     }
//   }


//   async findBySymbol(symbol: string) {

//     return this.marketRepo.findOne({
//       where: {
//         base: 'BTC',
//       },
//     });
//   }


// }








// import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
// import { InjectRepository } from "@nestjs/typeorm";
// import { Repository } from "typeorm";
// import { Exchange } from "@/common/enums/exchanges.enums";
// import { SymbolEntity } from "@/ingestion/symbols/entities/symbol.entity";
// import { BinanceWebSocket } from "@/ingestion/exchanges/binance/binance.ws";
// import { MexcWebSocket } from "@/ingestion/exchanges/mexc/mexc.ws";
// import { MarketEntity } from "./market.entity";

// @Injectable()
// export class MarketDataService implements OnModuleInit {
//   private readonly logger = new Logger(MarketDataService.name);

//   constructor(
//     @InjectRepository(SymbolEntity)
//     private readonly symbolRepo: Repository<SymbolEntity>,

//     @InjectRepository(MarketEntity)
//     private readonly marketRepo: Repository<MarketEntity>,
//     private readonly binanceWs: BinanceWebSocket,
//     private readonly mexcWs: MexcWebSocket,
//   ) {}

//   async onModuleInit() {
//     this.logger.log('Starting canonical market engine…');

//     const symbols = await this.symbolRepo.find({
//       relations: ['exchanges', 'market'],
//     });

//     /**
//      * Map:
//      * BINANCE:ETHUSDT → marketId
//      * MEXC:ETHUSDT → marketId
//      */



// //     const symbolMarketMap: Record<string, number> = {};
// //     const symbolMetaMap: Record<string, { base: string; quote: string }> = {};
// //     const canonicalSymbols = symbols.filter(s =>
// //       s.market.id === canonicalMarketId
// //     );
// //     for (const s of canonicalSymbols) {
// //       for (const ex of s.exchanges) {
// //         const key = `${ex.exchange}:${s.symbol.toUpperCase()}`;
// //         symbolMarketMap[key] = s.market.id;
// //         symbolMetaMap[key] = {
// //           base: s.base,
// //           quote: s.quote,
// //         };
// //       }
// //     }

// //     // Sharding Binance (max 200 symbols per WS)
// //     const binanceSymbols = canonicalSymbols
// //       .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
// //       .map(s => s.symbol);

// //     const BINANCE_CHUNK = 200;
// //     for (let i = 0; i < binanceSymbols.length; i += BINANCE_CHUNK) {
// //       const chunk = binanceSymbols.slice(i, i + BINANCE_CHUNK);
// //       this.logger.log(`Binance WS symbols: ${chunk.length}`);
// //       this.binanceWs.connect(chunk, symbolMarketMap,symbolMetaMap);
// //     }

// //     // Sharding MEXC (max 100 symbols per WS)
// //     const mexcSymbols = canonicalSymbols
// //       .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
// //       .map(s => s.symbol);

// //     const MEXC_CHUNK = 100;
// //     for (let i = 0; i < mexcSymbols.length; i += MEXC_CHUNK) {
// //       const chunk = mexcSymbols.slice(i, i + MEXC_CHUNK);
// //       this.logger.log(`MEXC WS symbols: ${chunk.length}`);
// //       this.mexcWs.connect(chunk, symbolMarketMap,symbolMetaMap);
// //     }
// //   }


// //   async findBySymbol(symbol: string) {

// //     return this.marketRepo.findOne({
// //       where: {
// //         base: 'BTC',
// //       },
// //     });
// //   }


// // }
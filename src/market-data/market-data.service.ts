import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import { Exchange } from '@/common/enums/exchanges.enums';
import { BinanceWebSocket } from '@/ingestion/exchanges/binance/binance.ws';
import { MexcWebSocket } from '@/ingestion/exchanges/mexc/mexc.ws';

@Injectable()
export class MarketDataService implements OnModuleInit {

  // //better for migration later do that
  // export class MarketDataService implements OnApplicationBootstrap {
  //     async onApplicationBootstrap() {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    @InjectRepository(SymbolEntity)
    private readonly symbolRepo: Repository<SymbolEntity>,
    private readonly binanceWs: BinanceWebSocket,
    private readonly mexcWs: MexcWebSocket,
  ) { }

  async onModuleInit() {
    this.logger.log('Starting market data engine…');

    const symbols = await this.symbolRepo.find({
      relations: ['exchanges'],
      //   where: { active: true }, // optional but recommended
    });
    const symbolMap: Record<string, number> = {};
    for (const s of symbols) {
      symbolMap[s.symbol] = s.id;
    }
  
    const binanceSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.BINANCE))
      .map(s => s.symbol);

    const mexcSymbols = symbols
      .filter(s => s.exchanges.some(e => e.exchange === Exchange.MEXC))
      .map(s => s.symbol);

    if (binanceSymbols.length) {
      this.logger.log(`Binance WS symbols: ${binanceSymbols.length}`);
      this.binanceWs.connect(binanceSymbols,symbolMap);
    }
    if (mexcSymbols.length) {
      this.logger.log(`MEXC WS symbols: ${mexcSymbols.length}`);
      this.mexcWs.connect(mexcSymbols,symbolMap);
    }
  } 
}

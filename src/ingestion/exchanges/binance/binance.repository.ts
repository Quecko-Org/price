import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Binance } from "./binance.entity";
import { Repository } from "typeorm";

@Injectable()
export class BinanceRepository{

    constructor(
        @InjectRepository(Binance)
        private binanceRepository:Repository<Binance>
    ){}


    async savePrice(symbol: string, price: number) {
        const entity = this.binanceRepository.create({ symbol, price, time: new Date(),exchange:'binance' });
        await this.binanceRepository.save(entity);
      }


}
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Mexc } from "./mexc.entity";

@Injectable()
export class MexcRepository{

    constructor(
        @InjectRepository(Mexc)
        private mexcRepository:Repository<Mexc>
    ){}


    async savePrice(symbol: string, price: number) {
        const entity = this.mexcRepository.create({ symbol, price, time: new Date(),exchange:'mexc' });
        await this.mexcRepository.save(entity);
      }


}
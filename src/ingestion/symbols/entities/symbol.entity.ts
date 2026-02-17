import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    Unique,
  } from 'typeorm';
  import { SymbolExchangeEntity } from './symbol-exchange.entity';
  
  @Entity('symbols')
  @Unique(['symbol', 'base', 'quote'])
  export class SymbolEntity {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column()
    symbol: string;
  
    @Column()
    base: string;
  
    @Column()
    quote: string;
  
    @OneToMany(
      () => SymbolExchangeEntity,
      se => se.symbol,
      {
        //  cascade: true,
         eager: true,

    
    },
    )
    exchanges: SymbolExchangeEntity[];
  }
  
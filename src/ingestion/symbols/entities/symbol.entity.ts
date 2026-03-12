// | id | symbol  | base | quote | market |
// | -- | ------- | ---- | ----- | ------ |
// | 10 | ETHUSDT | ETH  | USDT  | 1      |

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  Unique,
  ManyToOne,
  Index,
} from 'typeorm';

import { SymbolExchangeEntity } from './symbol-exchange.entity';
import { MarketEntity } from '@/market-data/market.entity';

@Entity('symbols')
@Unique(['symbol', 'base', 'quote'])
export class SymbolEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  symbol: string; // ETHUSDT

  @Column()
  base: string;

  @Column()
  quote: string;

  @ManyToOne(() => MarketEntity, { eager: true })
  market: MarketEntity;

  @OneToMany(
    () => SymbolExchangeEntity,
    se => se.symbol,
    {
      eager: true,
    },
  )
  exchanges: SymbolExchangeEntity[];
}
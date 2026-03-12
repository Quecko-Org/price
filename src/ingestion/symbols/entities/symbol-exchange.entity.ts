// | id | exchange | symbol |
// | -- | -------- | ------ |
// | 1  | BINANCE  | 10     |
// | 2  | MEXC     | 10     |

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Unique,
  Index,
} from 'typeorm';

import { Exchange } from '@/common/enums/exchanges.enums';
import { SymbolEntity } from './symbol.entity';

@Entity('symbol_exchanges')
@Unique(['exchange', 'symbol'])
@Index(['exchange'])
export class SymbolExchangeEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'enum',
    enum: Exchange,
  })
  exchange: Exchange;

  @ManyToOne(
    () => SymbolEntity,
    symbol => symbol.exchanges,
    { onDelete: 'CASCADE' },
  )
  symbol: SymbolEntity;

  // Historical ingestion tracking

  @Column({ type: 'timestamptz', nullable: true })
  firstCandleTime: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
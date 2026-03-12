import { MarketEntity } from '@/market-data/market.entity';
import {
  Entity,
  Column,
  PrimaryColumn,
  Index,
  ManyToOne,
} from 'typeorm';

@Entity('aggregated_candles_1m')
@Index(['marketId', 'openTime'])
export class Candle1mEntity {

  @PrimaryColumn({ type: 'bigint' })
  marketId: number;

  @PrimaryColumn({ type: 'timestamptz' })
  openTime: Date;

  @Column({ type: 'double precision' })
  open: number;

  @Column({ type: 'double precision' })
  high: number;

  @Column({ type: 'double precision' })
  low: number;

  @Column({ type: 'double precision' })
  close: number;

  @Column({ type: 'double precision' })
  volume: number;

  @ManyToOne(() => MarketEntity, { onDelete: 'CASCADE' })
  market: MarketEntity;

}


import { CandleInterval } from '@/common/enums/exchanges.enums';
import { SymbolEntity } from '@/ingestion/symbols/entities/symbol.entity';
import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  Index,
} from 'typeorm';

@Entity('aggregated_candles_1m')
@Index(['openTime'])

export class Candle1mEntity {
  // composite PK part 1
  @PrimaryColumn({ type: 'bigint', name: 'symbolId' })
  symbolId: number;

  // composite PK part 2 + hypertable time column
  @PrimaryColumn({ type: 'timestamptz', name: 'openTime' })
  openTime: Date;

  // composite PK part 3 + interval
  @PrimaryColumn({
    type: 'enum',
    enum: CandleInterval,
  })
  interval: CandleInterval;


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

  // optional relation (recommended)
  @ManyToOne(() => SymbolEntity, { onDelete: 'CASCADE' })
  symbol: SymbolEntity;
}


// await repo.find({
//   where: {
//     symbolId: 1,
//     openTime: Between(start, end),
//   },
//   order: { openTime: 'ASC' },
// });
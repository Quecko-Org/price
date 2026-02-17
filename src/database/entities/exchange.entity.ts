import { Entity, Column, PrimaryGeneratedColumn, PrimaryColumn, Index } from 'typeorm';

@Entity('binance')
@Index(['symbol', 'time'])
export class Binance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamptz',primary: true  })
  time: Date;

  @Column()
  symbol: string;

  @Column('numeric')
  price: number;

  @Column({ nullable: true })
  exchange?: string;
}

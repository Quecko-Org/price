import { Entity, Column, PrimaryGeneratedColumn, PrimaryColumn, Index } from 'typeorm';

// exchange pair price depth volume(24h) volume% liquidity


@Entity('mexc')
@Index(['symbol', 'time'])
export class Mexc {
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

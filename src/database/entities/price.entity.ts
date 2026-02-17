import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('prices')
@Index(['symbol', 'time'])
export class Price {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'timestamptz' })
  time: Date;

  @Column()
  symbol: string;

  @Column('numeric')
  price: number;

  @Column({ nullable: true })
  exchange?: string;
}





// | id | base | quote | symbol  |
// | -- | ---- | ----- | ------- |
// | 1  | ETH  | USD   | ETH-USD |


import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity('markets')
@Unique(['base', 'quote'])
export class MarketEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  base: string; // ETH

  @Index()
  @Column()
  quote: string; // USD

  @Index()
  @Column()
  symbol: string; // ETH-USD

  @CreateDateColumn()
  createdAt: Date;
}
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('tokens')
export class Token {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  @Index()
  chain: string;

  @Column({ type: 'text', unique: true })
  address: string;

  @Column({ type: 'text' })
  symbol: string;

  // 🔥 canonical symbol (ETH, BTC)
  @Column({ type: 'text', nullable: true })
  canonicalSymbol: string;

  @Column({ type: 'int' })
  decimals: number;

  // 🔥 stablecoin flag
  @Column({ default: false })
  isStable: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
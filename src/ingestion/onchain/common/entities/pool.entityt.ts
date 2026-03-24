import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index
} from 'typeorm';
import { Token } from './token.entity';

@Entity('dex_pools')
export class DexPool {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  dex: string;

  @Column()
  chain: string;

  @Column({ unique: true })
  poolAddress: string;

  @ManyToOne(() => Token)
  @JoinColumn({ name: 'token0_id' })
  token0: Token;

  @ManyToOne(() => Token)
  @JoinColumn({ name: 'token1_id' })
  token1: Token;

  @Column({ type: 'int', nullable: true })
  fee: number;

  // 🔥 total liquidity in USD
  @Column({ type: 'numeric', default: 0 })
  liquidityUsd: string;

  // 🔥 24h volume
  @Column({ type: 'numeric', default: 0 })
  volume24h: string;

  // 🔥 last trade timestamp
  @Column({ type: 'bigint', nullable: true })
  lastSwapAt: number;

  // 🔥 ranking score (computed)
  @Column({ type: 'numeric', default: 0 })
  score: string;

  // 🔥 active pool flag
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
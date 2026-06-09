import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Token } from './token.entity';
import { Chain, DexType } from '../chain.config';

/* =========================
   ENUMS (IMPORTANT)
========================= */



@Entity('dex_pools')
@Index(['dex', 'chainId'])
@Index(['token0', 'token1'])
export class DexPool {

  @PrimaryGeneratedColumn()
  id: number;

  /* =========================
     CORE IDENTIFICATION
  ========================= */

  @Column({ type: 'enum', enum: DexType })
  dex: DexType;

  @Column({ type: 'enum', enum: Chain })
  chainId: Chain; // 1 = ETH, 137 = Polygon, etc.

  /**
   * 🔥 UNIFIED KEY
   * V3 → pool address
   * V4 → poolId (bytes32)
   */
  @Column({ unique: true })
  @Index()
  poolKey: string;

  /* =========================
     TOKENS
  ========================= */

  @ManyToOne(() => Token)
  @JoinColumn({ name: 'token0_id' })
  @Index()
  token0: Token;

  @ManyToOne(() => Token)
  @JoinColumn({ name: 'token1_id' })
  @Index()
  token1: Token;

  /* =========================
     POOL CONFIG
  ========================= */

  @Column({ type: 'int', nullable: true })
  fee: number;

  // V4 specific
  @Column({ nullable: true })
  tickSpacing: number;

  @Column({ nullable: true })
  hooks: string;

  /* =========================
     LIQUIDITY STATE
  ========================= */

  @Column({ type: 'double precision', default: 0 })
  token0Balance: number;

  @Column({ type: 'double precision', default: 0 })
  token1Balance: number;

  @Column({ type: 'double precision', default: 0 })
  liquidityUsd: number;

  @Column({ type: 'double precision', default: 0 })
  price: number;

  /* =========================
     TRADING STATS
  ========================= */

  @Column({ type: 'double precision', default: 0 })
  volume24h: number;

  @Column({ type: 'bigint', nullable: true })
  lastSwapAt: number;

  /**
   * 🔥 IMPORTANT: keep numeric, NOT string
   */
  @Column({ type: 'double precision', default: 0 })
  score: number;

  /* =========================
     FLAGS
  ========================= */
 
  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isInitialized: boolean; // 🔥 track multicall init

  @Column({ nullable: true })
  quoteTokenAddress:string;
  /* =========================
     META
  ========================= */

  @CreateDateColumn()
  createdAt: Date;
}
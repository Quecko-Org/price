// ============================================================
// pool-market.entity.ts
//
// Links one DEX pool to one market.
// One pool can have MULTIPLE rows — one per market it serves.
//
// Example:
//   USDC/ETH pool → row 1: marketId=ETH-USD,  baseIsToken0=false (ETH=token1)
//                 → row 2: marketId=USDC-USD, baseIsToken0=true  (USDC=token0)
//
// baseIsToken0: tells the swap handler which token is the market base
//   true  → base token is token0 → price = (1/sqrtRatio) × token0_usd
//   false → base token is token1 → price = sqrtRatio × token1_usd
//
// This removes ALL direction logic from adapters and mappers.
// The swap handler just reads baseIsToken0 and computes price.
// ============================================================
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MarketEntity } from '@/market-data/market.entity';

@Entity('dex_market_maps')
@Index(['poolId', 'marketId'], { unique: true })
export class DexMarketMap {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  poolId: number;

  @Column()
  @Index()
  marketId: number;

  /**
   * Which token is the market's base asset.
   * true  = token0 is the base (e.g. pool is ETH/USDC, market is ETH-USD)
   * false = token1 is the base (e.g. pool is USDC/ETH, market is ETH-USD)
   *
   * Set once at mapping time — never changes for a pool/market pair.
   * Swap handler reads this to know price direction without re-deriving.
   */
  @Column({ default: false })
  baseIsToken0: boolean;

  @ManyToOne(() => MarketEntity)
  @JoinColumn({ name: 'marketId' })
  market: MarketEntity;
}
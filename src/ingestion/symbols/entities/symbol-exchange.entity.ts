// ============================================================
// symbol-exchange.entity.ts
//
// Represents ONE symbol on ONE exchange.
// This is the correct place for per-exchange market data because:
//   - markets table = aggregated (all exchanges combined)
//   - symbols table = symbol metadata (base, quote, name)
//   - symbol_exchanges = symbol × exchange junction → per-exchange stats live here
//
// Layout:
// | id | exchange | symbol | price | volume24h | bid | ask | spread | updatedAt |
// | 1  | BINANCE  | 10(ETH)| 3200  | 13688     | ... | ... | 0.01%  | now       |
// | 2  | MEXC     | 10(ETH)| 3200  | 4390      | ... | ... | 0.02%  | now       |
// ============================================================
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Unique,
  Index,
  UpdateDateColumn,
} from 'typeorm';

import { Exchange } from '@/common/enums/exchanges.enums';
import { SymbolEntity } from './symbol.entity';

@Entity('symbol_exchanges')
@Unique(['exchange', 'symbol'])
@Index(['exchange'])
@Index(['exchange', 'updatedAt'])  // for querying freshest data per exchange
export class SymbolExchangeEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: Exchange })
  exchange: Exchange;

  @ManyToOne(() => SymbolEntity, symbol => symbol.exchanges, { onDelete: 'CASCADE' })
  symbol: SymbolEntity;

  // ── Historical ingestion tracking (existing) ─────────────
  @Column({ type: 'timestamptz', nullable: true })
  firstCandleTime: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  // ── Per-exchange real-time market data (new) ──────────────

  /** Current last traded price on this exchange (USD) */
  @Column({ type: 'double precision', nullable: true })
  lastPrice: number | null;

  /** 24h price change percentage on this exchange */
  @Column({ type: 'double precision', nullable: true })
  priceChange24h: number | null;

  /** 24h high on this exchange */
  @Column({ type: 'double precision', nullable: true })
  high24h: number | null;

  /** 24h low on this exchange */
  @Column({ type: 'double precision', nullable: true })
  low24h: number | null;

  /** 24h traded volume in base token (e.g. BTC) on this exchange */
  @Column({ type: 'double precision', nullable: true })
  volume24hBase: number | null;

  /** 24h traded volume in USD on this exchange */
  @Column({ type: 'double precision', nullable: true })
  volume24hUsd: number | null;

  /** Best bid price (top of order book) */
  @Column({ type: 'double precision', nullable: true })
  bidPrice: number | null;

  /** Best ask price (top of order book) */
  @Column({ type: 'double precision', nullable: true })
  askPrice: number | null;

  /**
   * Bid-ask spread as a percentage: (ask - bid) / mid × 100
   * Lower = more liquid. < 0.05% = very liquid, > 0.5% = thin market.
   */
  @Column({ type: 'double precision', nullable: true })
  spreadPct: number | null;

  /**
   * Order book depth — USD value of bids within 2% of mid price.
   * Higher = more liquid. Fetched from /depth endpoint, not ticker.
   * Updated less frequently (every 5 min) to avoid rate limits.
   */
  @Column({ type: 'double precision', nullable: true })
  depthBid2pct: number | null;

  /** USD value of asks within 2% of mid price */
  @Column({ type: 'double precision', nullable: true })
  depthAsk2pct: number | null;

  /** When this row's market data was last refreshed */
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
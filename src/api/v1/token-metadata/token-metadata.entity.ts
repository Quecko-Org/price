// ============================================================
// token-metadata.entity.ts
//
// One row per token. Stores everything shown on a CMC token page
// that isn't real-time price data:
//   - Supply: circulating, total, max, FDV
//   - Contract addresses per chain
//   - Links: website, whitepaper, socials, explorer
//   - All-time high/low with dates
//   - Description / about text
//   - Tags / categories
//   - Holders count (updated periodically)
//
// Separate from markets table because:
//   - Updated infrequently (weekly/manually) not per-candle
//   - Optional — not every market has metadata
//   - Can be seeded from CoinGecko/CMC free API or entered manually
// ============================================================
import {
  Entity, PrimaryGeneratedColumn, Column, OneToOne,
  JoinColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { MarketEntity } from '@/market-data/market.entity';

@Entity('token_metadata')
export class TokenMetadataEntity {

  @PrimaryGeneratedColumn()
  id: number;

  // One-to-one with market (ETH-USD → ETH metadata)
  @OneToOne(() => MarketEntity)
  @JoinColumn({ name: 'marketId' })
  market: MarketEntity;

  @Column({ unique: true })
  @Index()
  marketId: number;

  // ── Identity ───────────────────────────────────────────────
  @Column({ nullable: true })
  name: string;                    // "Ethereum" (full name)

  @Column({ nullable: true })
  symbol: string;                  // "ETH"

  @Column({ type: 'text', nullable: true })
  description: string;             // "About" text from CMC

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];                  // ["defi", "layer-1", "pos"]

  @Column({ nullable: true })
  logoUrl: string;                 // token logo image URL

  // ── Supply ─────────────────────────────────────────────────
  @Column({ type: 'double precision', nullable: true })
  circulatingSupply: number;       // e.g. 120_000_000 ETH

  @Column({ type: 'double precision', nullable: true })
  totalSupply: number;

  @Column({ type: 'double precision', nullable: true })
  maxSupply: number;               // null = no max (ETH, DOGE)

  @Column({ type: 'double precision', nullable: true })
  fdv: number;                     // fully diluted valuation (USD)

  @Column({ type: 'double precision', nullable: true })
  marketCap: number;               // circulating × price (USD)

  @Column({ type: 'integer', nullable: true })
  holders: number;                 // unique holder count

  // ── All-time high / low ─────────────────────────────────────
  @Column({ type: 'double precision', nullable: true })
  ath: number;                     // all-time high price (USD)

  @Column({ type: 'timestamptz', nullable: true })
  athDate: Date;

  @Column({ type: 'double precision', nullable: true })
  atl: number;                     // all-time low price (USD)

  @Column({ type: 'timestamptz', nullable: true })
  atlDate: Date;

  // ── Contract addresses ──────────────────────────────────────
  // Array of { chainId, address, standard } objects stored as JSON
  // e.g. [{ chainId: 1, address: "0x...", standard: "ERC-20" },
  //        { chainId: 56, address: "0x...", standard: "BEP-20" }]
  @Column({ type: 'jsonb', default: '[]' })
  contracts: {
    chainId:  number;
    address:  string;
    standard: string;   // "ERC-20", "BEP-20", "SPL" etc.
  }[];

  // ── Links ───────────────────────────────────────────────────
  @Column({ type: 'text', array: true, default: '{}' })
  websites: string[];              // ["https://ethereum.org"]

  @Column({ type: 'text', array: true, default: '{}' })
  explorers: string[];             // ["https://etherscan.io"]

  @Column({ nullable: true })
  whitepaper: string;              // URL

  // Socials as JSONB — flexible, different tokens have different socials
  // e.g. { twitter: "ethereum", telegram: "...", discord: "...", reddit: "..." }
  @Column({ type: 'jsonb', default: '{}' })
  socials: Record<string, string>;

  // Source tracking — where was this data pulled from?
  @Column({ nullable: true })
  dataSource: string;              // "coingecko", "coinmarketcap", "manual"

  @Column({ nullable: true })
  externalId: string;              // CoinGecko ID or CMC ID for re-fetching

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
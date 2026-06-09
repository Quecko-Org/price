// chain-sync-state.entity.ts
// FIX: bigint columns return string from pg driver.
// Added ValueTransformer to auto-convert to Number on read.
import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Chain } from '../chain.config';

// Transformer applied to every bigint column.
// pg driver returns bigint as string — this converts it back to number on read.
const bigintTransformer = {
  to:   (v: number) => v,           // write: number → pg stores as bigint
  from: (v: string | number) => Number(v), // read: string → number
};

@Entity('chain_sync_state')
export class ChainSyncStateEntity {

  @PrimaryColumn({ type: 'enum', enum: Chain })
  chainId: Chain;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  lastScannedBlock: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  deployBlock: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
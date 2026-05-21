// ============================================================
// chain-sync-state.entity.ts
//
// Stores the last successfully scanned block per chain.
// V4 backfill reads this to resume where it left off after restart.
//
// Without this: every restart re-scans from V4 deployment block
// (block 21688329 for Ethereum = millions of blocks = hours).
// With this: restart resumes from last_scanned_block in seconds.
// ============================================================
import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Chain } from '../chain.config';

@Entity('chain_sync_state')
export class ChainSyncStateEntity {

    /** chainId — primary key (one row per chain) */
    @PrimaryColumn({
        type: 'enum',
        enum: Chain
    })
    chainId: Chain;

    /** Last block successfully processed during V4 backfill */
    @Column({ type: 'bigint', default: 0 })
    lastScannedBlock: number;

    /** Block number where V4 was deployed (starting point if DB empty) */
    @Column({ type: 'bigint', default: 0 })
    deployBlock: number;

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date;
}
// ============================================================
// ingestion-cron.service.ts — PRODUCTION OPTIMISED
//
// Controls all on-chain ingestion scheduling.
// TokenSyncService and DexAutoMapperService are pure work functions —
// this service owns the cron schedule and guards against overlap.
//
// SCHEDULE DESIGN:
//
//   fullSync() — every 6 hours
//     Why: Token lists rarely change. Daily is sufficient but 6h
//     catches new listings within the same trading day.
//     With Redis hash cache in TokenSyncService, 99% of runs
//     complete in <100ms (cache hit → nothing to do).
//
//   mapOnly() — every 10 minutes
//     Why: New DEX pools are discovered continuously by the
//     V3/V4 pool scanners. They get saved to dex_pools but
//     have no market mapping yet. Running mapper every 10min
//     ensures pools get mapped quickly without the heavy
//     token list fetch.
//
// RUN ORDER (important):
//   1. Token sync → ensures tokens table is populated
//   2. Pool scanner (runs independently in OnchainService)
//   3. Mapper → pools + tokens → market IDs
//   This order ensures the mapper always has both tokens and pools.
// ============================================================
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TokenSyncService } from './token-syncing/token-sync.service';
import { DexAutoMapperService } from './token-syncing/dex-auto-mapper.service';

@Injectable()
export class IngestionCronService implements OnModuleInit {
  private readonly logger      = new Logger(IngestionCronService.name);
  private fullSyncRunning      = false;
  private mapOnlyRunning       = false;

  constructor(
    private readonly tokenSync:   TokenSyncService,
    private readonly autoMapper:  DexAutoMapperService,
  ) {}

  // ── Run once on boot ─────────────────────────────────────────
  // Ensures tokens and mappings exist immediately on startup
  // without waiting for the first cron tick.
  async onModuleInit() {
    this.logger.log('IngestionCronService: running initial sync on boot...');
    // Small delay so DB/Redis connections are fully ready
    setTimeout(() => this.runFullSync(), 5_000);
  }

  // ── Full sync — every 6 hours ─────────────────────────────────
  // Fetches token lists + maps all pools to markets.
  // TokenSyncService uses Redis hash — fast if lists unchanged.
  @Cron('0 0 */6 * * *')
  // @Cron('*/1 * * * *')  
  async fullSync(): Promise<void> {
    await this.runFullSync();
  }

  // ── Map only — every 10 minutes ──────────────────────────────
  // Just runs the mapper — no token list fetch.
  // Catches newly discovered pools quickly.
    @Cron('*/1 * * * *')  
  // @Cron('0 */10 * * * *')
  async mapOnly(): Promise<void> {
    if (this.mapOnlyRunning) {
      this.logger.debug('mapOnly already running — skipping');
      return;
    }
    this.mapOnlyRunning = true;
    try {
       await this.autoMapper.map();
    
    } catch (err: any) {
      this.logger.error(`mapOnly failed: ${err?.message}`);
    } finally {
      this.mapOnlyRunning = false;
    }
  }

  // ── Internal full sync (called by cron + onModuleInit) ────────
  private async runFullSync(): Promise<void> {
    console.log("token syn srvicee")
    if (this.fullSyncRunning) {
      this.logger.warn('fullSync already running — skipping');
      return;
    }
    this.fullSyncRunning = true;
    this.logger.log('🔄 fullSync starting (token sync + mapping)...');

    try {
      // Step 1: sync tokens for all enabled chains
      await this.tokenSync.sync();

    } catch (err: any) {
      this.logger.error(`fullSync failed: ${err?.message}`);
    } finally {
      this.fullSyncRunning = false;
    }
  }
}
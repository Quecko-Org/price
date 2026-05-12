// ============================================================
// ingestion-cron.service.ts
//
// Cron jobs for token sync and pool-to-market mapping.
//
// fullSync() now syncs ALL enabled chains automatically.
// TokenSyncService.sync() calls syncChain() per enabled chain.
// DexAutoMapperService.map() is chain-agnostic (reads all pools).
//
// Frequency: every 10 min — fast enough to catch new markets
// from CEX, slow enough to avoid rate-limiting token list APIs.
// ============================================================
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { TokenSyncService } from "./token-syncing/token-sync.service";
import { DexAutoMapperService } from "./token-syncing/dex-auto-mapper.service";

@Injectable()
export class IngestionCronService {
  private readonly logger = new Logger(IngestionCronService.name);
  private syncRunning = false;

  constructor(
    private readonly tokenSync: TokenSyncService,
    private readonly autoMapper: DexAutoMapperService,
  ) {}

  // ── Every 10 minutes ────────────────────────────────────────
  // 1. Sync tokens for ALL enabled chains
  // 2. Map all pools → markets
  //
  // Guard: if previous run is still going, skip this tick.
  // Token list fetches can be slow — prevent overlap.
  async fullSync() {
    if (this.syncRunning) {
      this.logger.warn('fullSync already running — skipping this tick');
      return;
    }

    this.syncRunning = true;
    this.logger.log('🔄 fullSync starting...');

    try {
      // TokenSyncService now handles ALL enabled chains internally
      await this.tokenSync.sync();

      // DexAutoMapperService maps all pools across all chains
      await this.autoMapper.map();

      this.logger.log('✅ fullSync complete');

    } catch (err) {
      this.logger.error('fullSync failed', err);
    } finally {
      this.syncRunning = false;
    }
  }
}
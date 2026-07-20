import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { DailyBarsService } from './daily-bars.service';
import { SCAN_UNIVERSE } from './scan-universe';

export const INGESTION_QUEUE = 'market-data-ingestion';

const BACKFILL_JOB = 'daily-bar-backfill';
/** Legacy per-minute quote-as-bar job; removed on startup if still scheduled. */
const LEGACY_JOB = 'ingest-universe';
const BACKFILL_LOOKBACK_DAYS = 7;

interface BackfillJobData {
  symbols: string[];
}

/**
 * BullMQ worker for the reliable historical path: a daily REST backfill that
 * fetches 1d bars from the provider for the whole scan universe (500+
 * symbols) and upserts them into the TimescaleDB `bars` hypertable (created
 * by infra/postgres/init.sql, outside Prisma). Fetching goes through
 * DailyBarsService, which batches multi-symbol requests and rate-limits the
 * provider, so scan runs are served from the local DB the next day.
 *
 * Intraday 1-minute bars are produced by BarAggregatorService from the
 * realtime quote stream; this worker no longer writes quote-derived rows.
 */
@Injectable()
export class IngestionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionWorker.name);
  private queue?: Queue<BackfillJobData>;
  private worker?: Worker<BackfillJobData>;

  constructor(
    private readonly config: ConfigService,
    private readonly dailyBars: DailyBarsService,
  ) {}

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') {
      this.logger.log('Workers disabled via DISABLE_WORKERS');
      return;
    }
    const connection = this.connectionOptions();

    this.queue = new Queue<BackfillJobData>(INGESTION_QUEUE, { connection });
    this.worker = new Worker<BackfillJobData>(
      INGESTION_QUEUE,
      async (job) => this.backfillDailyBars(job.data.symbols),
      { connection },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Backfill job ${job?.id} failed: ${err.message}`),
    );

    try {
      await this.removeLegacyRepeatableJobs();
      // Weekdays at 21:30 UTC, after the US session close.
      await this.queue.add(
        BACKFILL_JOB,
        { symbols: [...SCAN_UNIVERSE] },
        {
          repeat: { pattern: '30 21 * * 1-5' },
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not schedule daily backfill: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Fetch recent 1d bars (batched + rate-limited) and upsert them at UTC
   * midnight, overwriting intraday rollups (provider data wins).
   */
  async backfillDailyBars(symbols: string[]) {
    const to = new Date();
    const from = new Date(
      to.getTime() - BACKFILL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const upserted = await this.dailyBars.fetchAndStoreDailyBars(
      symbols,
      from,
      to,
    );
    this.logger.log(
      `Daily backfill upserted ${upserted} bars for ${symbols.length} symbols`,
    );
  }

  /** The old every-minute quote-as-bar job must not keep firing from Redis. */
  private async removeLegacyRepeatableJobs() {
    if (!this.queue) return;
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      if (job.name === LEGACY_JOB) {
        await this.queue.removeRepeatableByKey(job.key);
        this.logger.log(`Removed legacy repeatable job ${job.name}`);
      }
    }
  }

  private connectionOptions() {
    const url = new URL(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
    };
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}

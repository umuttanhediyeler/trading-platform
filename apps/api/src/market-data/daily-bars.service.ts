import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  RateLimiter,
  chunk,
  groupBarsBySymbol,
  isSeriesUsable,
  mapWithConcurrency,
  utcDayStart,
} from '@trading-platform/data';
import { PrismaService } from '../prisma/prisma.service';
import {
  Bar,
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from './providers/market-data-provider.interface';

export interface LatestDailyBarsOptions {
  /** Newest bars kept per symbol (window fed to the indicators). */
  maxBarsPerSymbol?: number;
  /** Minimum bars required before a DB series is considered sufficient. */
  minBars?: number;
  /**
   * Maximum age of the newest DB bar before the symbol is refreshed from the
   * provider. Defaults to 5 days, which tolerates weekends + one holiday.
   */
  maxStalenessMs?: number;
  /** Provider fallback window start (default: 90 days before `to`). */
  from?: Date;
  /** Provider fallback window end (default: now). */
  to?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BARS = 60;
const DEFAULT_MIN_BARS = 21; // volume_ratio needs 20 prior bars + the latest
const DEFAULT_MAX_STALENESS_MS = 5 * DAY_MS;
const DEFAULT_FALLBACK_LOOKBACK_DAYS = 90;
const PERSIST_ROWS_PER_STATEMENT = 500;

/**
 * Bulk access to daily OHLCV bars for large symbol universes (500+).
 *
 * Read path: one windowed SQL query against the TimescaleDB `bars`
 * hypertable returns the latest N daily bars for every requested symbol at
 * once — no per-symbol round trips.
 *
 * Fallback path: symbols with missing/stale DB coverage are fetched from the
 * market-data provider using its multi-symbol batch endpoint when available,
 * otherwise per-symbol with bounded concurrency. Every provider request
 * passes through a sliding-window rate limiter so bulk scans respect vendor
 * quotas. Fetched bars are written back to the DB so subsequent scans are
 * served locally.
 */
@Injectable()
export class DailyBarsService {
  private readonly logger = new Logger(DailyBarsService.name);
  private readonly limiter: RateLimiter;
  private readonly concurrency: number;
  private readonly batchSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(MARKET_DATA_PROVIDER)
    private readonly provider: MarketDataProvider,
  ) {
    this.concurrency = this.positiveInt('SCAN_PROVIDER_CONCURRENCY', 4);
    this.batchSize = this.positiveInt('SCAN_PROVIDER_BATCH_SIZE', 100);
    this.limiter = new RateLimiter({
      maxRequests: this.positiveInt('SCAN_PROVIDER_MAX_REQUESTS_PER_MINUTE', 180),
      perMs: 60_000,
    });
  }

  /**
   * Latest daily bars (ascending) for every symbol, DB-first with a safe
   * provider fallback. Symbols with no data anywhere are absent from the map.
   */
  async getLatestDailyBars(
    symbols: readonly string[],
    options: LatestDailyBarsOptions = {},
  ): Promise<Map<string, Bar[]>> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter(
      Boolean,
    );
    if (unique.length === 0) return new Map();

    const maxBars = options.maxBarsPerSymbol ?? DEFAULT_MAX_BARS;
    const minBars = options.minBars ?? DEFAULT_MIN_BARS;
    const maxStalenessMs = options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
    const to = options.to ?? new Date();
    const from =
      options.from ??
      new Date(to.getTime() - DEFAULT_FALLBACK_LOOKBACK_DAYS * DAY_MS);

    const result = await this.loadLatestFromDb(unique, maxBars, from);

    const now = new Date();
    const missing = unique.filter(
      (symbol) =>
        !isSeriesUsable(result.get(symbol) ?? [], minBars, maxStalenessMs, now),
    );
    if (missing.length === 0) return result;

    this.logger.log(
      `DB coverage sufficient for ${unique.length - missing.length}/${unique.length} symbols; fetching ${missing.length} from provider '${this.provider.name}'`,
    );
    const fetched = await this.fetchDailyBars(missing, from, to);
    await this.persistDailyBars([...fetched.values()].flat());
    for (const [symbol, bars] of fetched) {
      const existing = result.get(symbol) ?? [];
      // Prefer the freshly fetched series unless the DB copy is longer.
      if (bars.length >= existing.length) {
        result.set(symbol, bars.slice(-maxBars));
      }
    }
    return result;
  }

  /**
   * Fetches daily bars from the provider for many symbols, preferring the
   * vendor's multi-symbol batch endpoint and falling back to bounded
   * per-symbol requests. Bars are normalized (validated, sorted,
   * de-duplicated) and bucketed at UTC midnight — the canonical daily row.
   * Individual failures are logged and skipped, never thrown.
   */
  async fetchDailyBars(
    symbols: readonly string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, Bar[]>> {
    const collected: Bar[] = [];

    if (this.provider.getHistoricalBarsBatch) {
      for (const group of chunk([...symbols], this.batchSize)) {
        await this.limiter.acquire();
        try {
          const batch = await this.provider.getHistoricalBarsBatch(
            group,
            '1d',
            from,
            to,
          );
          for (const bars of batch.values()) collected.push(...bars);
        } catch (err) {
          this.logger.warn(
            `Batch bar fetch failed for ${group.length} symbols (${group[0]}…): ${(err as Error).message}`,
          );
        }
      }
    } else {
      const results = await mapWithConcurrency(
        [...symbols],
        this.concurrency,
        async (symbol) => {
          await this.limiter.acquire();
          return this.provider.getHistoricalBars(symbol, '1d', from, to);
        },
      );
      for (const res of results) {
        if (res.ok) collected.push(...res.value);
        else
          this.logger.warn(
            `Bar fetch failed for ${res.item}: ${(res.error as Error)?.message ?? res.error}`,
          );
      }
    }

    const daily = collected.map((bar) => ({
      ...bar,
      timestamp: utcDayStart(bar.timestamp),
    }));
    return groupBarsBySymbol(daily);
  }

  /** Fetches from the provider and writes through to the DB. Returns rows stored. */
  async fetchAndStoreDailyBars(
    symbols: readonly string[],
    from: Date,
    to: Date,
  ): Promise<number> {
    const fetched = await this.fetchDailyBars(symbols, from, to);
    return this.persistDailyBars([...fetched.values()].flat());
  }

  /**
   * Bulk-upserts daily bars into the `bars` hypertable in multi-row
   * statements (provider data overwrites intraday rollups). Persistence
   * failures are logged, not thrown — a DB hiccup must not fail a scan whose
   * data was already fetched.
   */
  async persistDailyBars(bars: readonly Bar[]): Promise<number> {
    let stored = 0;
    for (const group of chunk([...bars], PERSIST_ROWS_PER_STATEMENT)) {
      const values = Prisma.join(
        group.map(
          (b) =>
            Prisma.sql`(${b.symbol}, ${utcDayStart(b.timestamp)}, ${b.open}, ${b.high}, ${b.low}, ${b.close}, ${b.volume})`,
        ),
      );
      try {
        await this.prisma.$executeRaw`
          INSERT INTO bars (symbol, "timestamp", open, high, low, close, volume)
          VALUES ${values}
          ON CONFLICT (symbol, "timestamp") DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
        `;
        stored += group.length;
      } catch (err) {
        this.logger.warn(
          `Failed to persist ${group.length} daily bars: ${(err as Error).message}`,
        );
      }
    }
    return stored;
  }

  /**
   * One query for "latest N daily bars per symbol" across the whole universe,
   * served by the (symbol, timestamp DESC) index. Daily rows are the ones at
   * exactly UTC midnight — intraday minute bars never land there because the
   * US session (13:30–21:00 UTC) does not touch 00:00 UTC.
   */
  private async loadLatestFromDb(
    symbols: readonly string[],
    maxBars: number,
    from: Date,
  ): Promise<Map<string, Bar[]>> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        symbol: string;
        timestamp: Date;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>
    >`
      SELECT symbol, "timestamp", open, high, low, close, volume
      FROM (
        SELECT b.symbol, b."timestamp", b.open, b.high, b.low, b.close, b.volume,
               row_number() OVER (
                 PARTITION BY b.symbol ORDER BY b."timestamp" DESC
               ) AS rn
        FROM bars b
        WHERE b.symbol IN (${Prisma.join([...symbols])})
          AND b."timestamp" = date_trunc('day', b."timestamp")
          AND b."timestamp" >= ${utcDayStart(from)}
      ) ranked
      WHERE rn <= ${maxBars}
      ORDER BY symbol ASC, "timestamp" ASC
    `;
    return groupBarsBySymbol(
      rows.map((r) => ({
        symbol: r.symbol,
        timestamp: new Date(r.timestamp),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      })),
    );
  }

  private positiveInt(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key));
    return Number.isInteger(raw) && raw > 0 ? raw : fallback;
  }
}

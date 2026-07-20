import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Quote } from './providers/market-data-provider.interface';

const MINUTE_MS = 60_000;
const FLUSH_SWEEP_MS = 15_000;

interface Candle {
  symbol: string;
  minuteStart: number; // epoch ms, aligned to minute boundary
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Aggregates realtime quotes into 1-minute OHLCV candles in memory and
 * flushes completed minutes into the TimescaleDB `bars` hypertable.
 *
 * On every minute flush the current day's daily bar (UTC-midnight timestamp)
 * is also upserted: open = first minute's open, high/low = running extremes,
 * close = latest close, volume = running sum. The daily REST backfill in
 * IngestionWorker later overwrites these rows with provider-authoritative
 * daily bars.
 */
@Injectable()
export class BarAggregatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BarAggregatorService.name);
  private readonly candles = new Map<string, Candle>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') return;
    // Sweep so candles still flush when a symbol goes quiet mid-session.
    this.sweepTimer = setInterval(() => {
      this.flushCompleted().catch((err: Error) =>
        this.logger.warn(`Bar flush sweep failed: ${err.message}`),
      );
    }, FLUSH_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  /** Fold a realtime quote into the symbol's current 1-minute candle. */
  async onQuote(quote: Quote): Promise<void> {
    if (!quote.symbol || !Number.isFinite(quote.price) || quote.price <= 0) {
      return;
    }
    const ts = Number.isFinite(quote.ts) ? quote.ts : Date.now();
    const minuteStart = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
    const volume =
      Number.isFinite(quote.volume) && quote.volume > 0 ? quote.volume : 0;

    const current = this.candles.get(quote.symbol);
    if (!current || current.minuteStart < minuteStart) {
      if (current) {
        await this.flushCandle(current);
      }
      this.candles.set(quote.symbol, {
        symbol: quote.symbol,
        minuteStart,
        open: quote.price,
        high: quote.price,
        low: quote.price,
        close: quote.price,
        volume,
      });
      return;
    }
    if (current.minuteStart > minuteStart) {
      // Late quote for an already-flushed minute; drop it.
      return;
    }
    current.high = Math.max(current.high, quote.price);
    current.low = Math.min(current.low, quote.price);
    current.close = quote.price;
    current.volume += volume;
  }

  /** Flush every candle whose minute has fully elapsed. */
  async flushCompleted(now: number = Date.now()): Promise<void> {
    const currentMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    for (const [symbol, candle] of this.candles) {
      if (candle.minuteStart < currentMinute) {
        this.candles.delete(symbol);
        await this.flushCandle(candle);
      }
    }
  }

  private async flushCandle(candle: Candle): Promise<void> {
    try {
      await this.upsertMinuteBar(candle);
      await this.upsertDailyRollup(candle);
    } catch (err) {
      // DB outage must not break the quote stream; the daily REST backfill
      // repairs gaps.
      this.logger.warn(
        `Failed to flush bar ${candle.symbol}@${new Date(candle.minuteStart).toISOString()}: ${(err as Error).message}`,
      );
    }
  }

  private async upsertMinuteBar(candle: Candle): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO bars (symbol, timestamp, open, high, low, close, volume)
      VALUES (${candle.symbol}, ${new Date(candle.minuteStart)}, ${candle.open},
              ${candle.high}, ${candle.low}, ${candle.close}, ${candle.volume})
      ON CONFLICT (symbol, timestamp) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume
    `;
  }

  private async upsertDailyRollup(candle: Candle): Promise<void> {
    const day = new Date(candle.minuteStart);
    const dayStart = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
    );
    // open is only taken from the first minute of the day (existing row wins).
    await this.prisma.$executeRaw`
      INSERT INTO bars (symbol, timestamp, open, high, low, close, volume)
      VALUES (${candle.symbol}, ${dayStart}, ${candle.open},
              ${candle.high}, ${candle.low}, ${candle.close}, ${candle.volume})
      ON CONFLICT (symbol, timestamp) DO UPDATE SET
        high = GREATEST(bars.high, EXCLUDED.high),
        low = LEAST(bars.low, EXCLUDED.low),
        close = EXCLUDED.close,
        volume = bars.volume + EXCLUDED.volume
    `;
  }

  async onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    // Persist whatever is in flight, including the current (incomplete) minute.
    const pending = [...this.candles.values()];
    this.candles.clear();
    for (const candle of pending) {
      await this.flushCandle(candle);
    }
  }
}

import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BarAggregatorService } from './bar-aggregator.service';
import { Quote } from './providers/market-data-provider.interface';
import { mergeUniverseWithWatchlists, UNIVERSE } from './universe';

/** Reconstructs the SQL text of a $executeRaw tagged-template call. */
function sqlOf(call: unknown[]): string {
  return (call[0] as ReadonlyArray<string>).join('?').replace(/\s+/g, ' ');
}

function valuesOf(call: unknown[]): unknown[] {
  return call.slice(1);
}

describe('BarAggregatorService', () => {
  let service: BarAggregatorService;
  let executeRaw: jest.Mock;

  // 2026-07-17T14:30:00.000Z — a fixed, minute-aligned reference instant.
  const minuteStart = Date.UTC(2026, 6, 17, 14, 30, 0);
  const dayStart = Date.UTC(2026, 6, 17);

  const quote = (partial: Partial<Quote>): Quote => ({
    symbol: 'AAPL',
    price: 100,
    volume: 10,
    ts: minuteStart,
    ...partial,
  });

  beforeEach(() => {
    executeRaw = jest.fn().mockResolvedValue(1);
    const config = { get: jest.fn().mockReturnValue('true') };
    const prisma = { $executeRaw: executeRaw };
    service = new BarAggregatorService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  });

  it('aggregates quotes into a correct OHLCV candle and flushes on the minute boundary', async () => {
    await service.onQuote(quote({ price: 100, volume: 10, ts: minuteStart }));
    await service.onQuote(quote({ price: 103, volume: 5, ts: minuteStart + 10_000 }));
    await service.onQuote(quote({ price: 98, volume: 7, ts: minuteStart + 30_000 }));
    await service.onQuote(quote({ price: 101, volume: 3, ts: minuteStart + 59_000 }));

    // Minute not complete yet: nothing flushed.
    await service.flushCompleted(minuteStart + 59_500);
    expect(executeRaw).not.toHaveBeenCalled();

    // One tick into the next minute: candle flushes (minute bar + daily rollup).
    await service.flushCompleted(minuteStart + 60_000);
    expect(executeRaw).toHaveBeenCalledTimes(2);

    const [minuteCall, dailyCall] = executeRaw.mock.calls;
    expect(valuesOf(minuteCall)).toEqual([
      'AAPL',
      new Date(minuteStart),
      100, // open = first
      103, // high = max
      98, // low = min
      101, // close = last
      25, // volume = sum
    ]);
    expect(valuesOf(dailyCall)[1]).toEqual(new Date(dayStart));
  });

  it('flushes the previous candle when a quote arrives in a new minute', async () => {
    await service.onQuote(quote({ price: 50, volume: 1, ts: minuteStart }));
    await service.onQuote(quote({ price: 51, volume: 2, ts: minuteStart + 61_000 }));

    expect(executeRaw).toHaveBeenCalledTimes(2); // minute bar + daily rollup
    expect(valuesOf(executeRaw.mock.calls[0])).toEqual([
      'AAPL',
      new Date(minuteStart),
      50,
      50,
      50,
      50,
      1,
    ]);

    // The new minute's candle is still open with the second quote.
    executeRaw.mockClear();
    await service.flushCompleted(minuteStart + 120_000);
    expect(valuesOf(executeRaw.mock.calls[0])).toEqual([
      'AAPL',
      new Date(minuteStart + 60_000),
      51,
      51,
      51,
      51,
      2,
    ]);
  });

  it('writes conflict-upsert SQL for both the minute bar and the daily rollup', async () => {
    await service.onQuote(quote({}));
    await service.flushCompleted(minuteStart + 60_000);

    const minuteSql = sqlOf(executeRaw.mock.calls[0]);
    expect(minuteSql).toContain('INSERT INTO bars');
    expect(minuteSql).toContain('ON CONFLICT (symbol, timestamp) DO UPDATE');
    expect(minuteSql).toContain('close = EXCLUDED.close');

    const dailySql = sqlOf(executeRaw.mock.calls[1]);
    expect(dailySql).toContain('ON CONFLICT (symbol, timestamp) DO UPDATE');
    expect(dailySql).toContain('GREATEST(bars.high, EXCLUDED.high)');
    expect(dailySql).toContain('LEAST(bars.low, EXCLUDED.low)');
    expect(dailySql).toContain('volume = bars.volume + EXCLUDED.volume');
  });

  it('tracks candles per symbol independently', async () => {
    await service.onQuote(quote({ symbol: 'AAPL', price: 10, ts: minuteStart }));
    await service.onQuote(quote({ symbol: 'MSFT', price: 20, ts: minuteStart }));
    await service.flushCompleted(minuteStart + 60_000);

    expect(executeRaw).toHaveBeenCalledTimes(4);
    const symbols = executeRaw.mock.calls.map((call) => valuesOf(call)[0]);
    expect(symbols).toEqual(['AAPL', 'AAPL', 'MSFT', 'MSFT']);
  });

  it('drops late quotes for already-flushed minutes and invalid prices', async () => {
    await service.onQuote(quote({ price: 100, ts: minuteStart + 60_000 }));
    // Late quote from the previous (already superseded) minute.
    await service.onQuote(quote({ price: 999, ts: minuteStart }));
    // Invalid prices.
    await service.onQuote(quote({ price: 0, ts: minuteStart + 60_000 }));
    await service.onQuote(quote({ price: NaN, ts: minuteStart + 60_000 }));

    await service.flushCompleted(minuteStart + 120_000);
    expect(valuesOf(executeRaw.mock.calls[0])).toEqual([
      'AAPL',
      new Date(minuteStart + 60_000),
      100,
      100,
      100,
      100,
      10,
    ]);
  });

  it('keeps the quote stream alive when the bars insert fails', async () => {
    executeRaw.mockRejectedValue(new Error('db down'));
    await service.onQuote(quote({}));
    await expect(
      service.flushCompleted(minuteStart + 60_000),
    ).resolves.toBeUndefined();
  });

  it('flushes in-flight candles on shutdown', async () => {
    await service.onQuote(quote({ price: 42, volume: 4 }));
    await service.onModuleDestroy();
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(valuesOf(executeRaw.mock.calls[0])).toEqual([
      'AAPL',
      new Date(minuteStart),
      42,
      42,
      42,
      42,
      4,
    ]);
  });
});

describe('mergeUniverseWithWatchlists', () => {
  it('unions, uppercases, de-duplicates and preserves base order', () => {
    expect(
      mergeUniverseWithWatchlists(['AAPL', 'MSFT'], ['msft', ' tsla ', 'AAPL']),
    ).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  it('enforces the symbol cap', () => {
    const merged = mergeUniverseWithWatchlists(UNIVERSE, ['ZZZZ'], 100);
    expect(merged).toHaveLength(100);
    expect(merged).not.toContain('ZZZZ');
  });

  it('universe holds ~100 unique symbols', () => {
    expect(new Set(UNIVERSE).size).toBe(UNIVERSE.length);
    expect(UNIVERSE.length).toBeGreaterThanOrEqual(95);
  });
});

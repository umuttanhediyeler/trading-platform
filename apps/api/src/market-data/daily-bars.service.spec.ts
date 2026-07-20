import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DailyBarsService } from './daily-bars.service';
import {
  Bar,
  MarketDataProvider,
} from './providers/market-data-provider.interface';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `count` fresh daily bars (UTC midnight, ascending, newest = today). */
function dailyBars(symbol: string, count: number, volume = 1_000): Bar[] {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Array.from({ length: count }, (_, i) => ({
    symbol,
    timestamp: new Date(today.getTime() - (count - 1 - i) * DAY_MS),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume,
  }));
}

/** Flattens per-symbol bar lists into the row shape the DB query returns. */
function toDbRows(barsBySymbol: Record<string, Bar[]>) {
  return Object.values(barsBySymbol).flat();
}

describe('DailyBarsService', () => {
  let queryRaw: jest.Mock;
  let executeRaw: jest.Mock;
  let provider: {
    name: string;
    getQuote: jest.Mock;
    getHistoricalBars: jest.Mock;
    getHistoricalBarsBatch?: jest.Mock;
    subscribeRealtime: jest.Mock;
  };

  const makeService = () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const prisma = { $queryRaw: queryRaw, $executeRaw: executeRaw };
    return new DailyBarsService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      provider as unknown as MarketDataProvider,
    );
  };

  beforeEach(() => {
    queryRaw = jest.fn().mockResolvedValue([]);
    executeRaw = jest.fn().mockResolvedValue(1);
    provider = {
      name: 'mock',
      getQuote: jest.fn(),
      getHistoricalBars: jest.fn().mockResolvedValue([]),
      subscribeRealtime: jest.fn(),
    };
  });

  it('serves entirely from the DB when coverage is fresh and deep enough', async () => {
    queryRaw.mockResolvedValue(
      toDbRows({
        AAPL: dailyBars('AAPL', 30),
        MSFT: dailyBars('MSFT', 30),
      }),
    );
    const service = makeService();

    const result = await service.getLatestDailyBars(['AAPL', 'MSFT']);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(provider.getHistoricalBars).not.toHaveBeenCalled();
    expect(result.get('AAPL')).toHaveLength(30);
    expect(result.get('MSFT')).toHaveLength(30);
    // Ascending order preserved for indicator math.
    const aapl = result.get('AAPL')!;
    expect(aapl[0].timestamp.getTime()).toBeLessThan(
      aapl[aapl.length - 1].timestamp.getTime(),
    );
  });

  it('fetches only under-covered symbols via the provider batch endpoint and persists them', async () => {
    queryRaw.mockResolvedValue(toDbRows({ AAPL: dailyBars('AAPL', 30) }));
    provider.getHistoricalBarsBatch = jest
      .fn()
      .mockResolvedValue(new Map([['MSFT', dailyBars('MSFT', 25)]]));
    const service = makeService();

    const result = await service.getLatestDailyBars(['AAPL', 'MSFT']);

    expect(provider.getHistoricalBarsBatch).toHaveBeenCalledTimes(1);
    expect(provider.getHistoricalBarsBatch).toHaveBeenCalledWith(
      ['MSFT'],
      '1d',
      expect.any(Date),
      expect.any(Date),
    );
    expect(provider.getHistoricalBars).not.toHaveBeenCalled();
    expect(result.get('MSFT')).toHaveLength(25);
    // Fetched bars are written back so the next scan is DB-served.
    expect(executeRaw).toHaveBeenCalled();
  });

  it('treats stale DB series as missing and refreshes them', async () => {
    const stale = dailyBars('AAPL', 30).map((b) => ({
      ...b,
      timestamp: new Date(b.timestamp.getTime() - 10 * DAY_MS),
    }));
    queryRaw.mockResolvedValue(stale);
    provider.getHistoricalBarsBatch = jest
      .fn()
      .mockResolvedValue(new Map([['AAPL', dailyBars('AAPL', 30)]]));
    const service = makeService();

    await service.getLatestDailyBars(['AAPL']);

    expect(provider.getHistoricalBarsBatch).toHaveBeenCalledWith(
      ['AAPL'],
      '1d',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('falls back to bounded per-symbol fetches when the provider has no batch endpoint', async () => {
    const service = makeService();
    provider.getHistoricalBars.mockImplementation(async (symbol: string) =>
      symbol === 'BAD' ? Promise.reject(new Error('boom')) : dailyBars(symbol, 25),
    );

    const result = await service.getLatestDailyBars(['AAPL', 'BAD', 'MSFT']);

    expect(provider.getHistoricalBars).toHaveBeenCalledTimes(3);
    expect(result.get('AAPL')).toHaveLength(25);
    expect(result.get('MSFT')).toHaveLength(25);
    expect(result.has('BAD')).toBe(false);
  });

  it('survives a total provider batch failure without throwing', async () => {
    provider.getHistoricalBarsBatch = jest
      .fn()
      .mockRejectedValue(new Error('rate limited'));
    const service = makeService();

    const result = await service.getLatestDailyBars(['AAPL']);

    expect(result.size).toBe(0);
  });

  it('normalizes fetched bars to UTC-midnight buckets before persisting', async () => {
    provider.getHistoricalBarsBatch = jest.fn().mockResolvedValue(
      new Map([
        [
          'AAPL',
          [
            {
              symbol: 'AAPL',
              timestamp: new Date('2026-07-17T14:30:00.000Z'),
              open: 1,
              high: 2,
              low: 1,
              close: 2,
              volume: 10,
            },
          ],
        ],
      ]),
    );
    const service = makeService();

    const result = await service.fetchDailyBars(
      ['AAPL'],
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-18T00:00:00.000Z'),
    );

    expect(result.get('AAPL')![0].timestamp.toISOString()).toBe(
      '2026-07-17T00:00:00.000Z',
    );
  });

  it('chunks bulk upserts into bounded multi-row statements', async () => {
    const service = makeService();
    const bars = dailyBars('AAPL', 30).concat(dailyBars('MSFT', 30));

    const stored = await service.persistDailyBars(bars);

    expect(stored).toBe(60);
    expect(executeRaw).toHaveBeenCalledTimes(1); // 60 rows < 500-row chunk
    const sql = (executeRaw.mock.calls[0][0] as ReadonlyArray<string>).join('?');
    expect(sql).toContain('INSERT INTO bars');
    expect(sql).toContain('ON CONFLICT (symbol, "timestamp") DO UPDATE');
  });
});

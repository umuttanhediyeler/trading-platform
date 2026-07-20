import { DailyBarsService } from '../market-data/daily-bars.service';
import { Bar } from '../market-data/providers/market-data-provider.interface';
import { FilterGroup } from './filters/filter.types';
import { ScanExecutionService } from './scan-execution.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds an ascending daily series whose latest bar has `lastVolume`,
 * following 24 bars of `baseVolume` — so volume_ratio ≈ lastVolume/baseVolume.
 */
function series(symbol: string, baseVolume: number, lastVolume: number): Bar[] {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const bars: Bar[] = Array.from({ length: 24 }, (_, i) => ({
    symbol,
    timestamp: new Date(today.getTime() - (24 - i) * DAY_MS),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: baseVolume,
  }));
  bars.push({
    symbol,
    timestamp: today,
    open: 100,
    high: 101,
    low: 99,
    close: 102,
    volume: lastVolume,
  });
  return bars;
}

const VOLUME_SPIKE_DSL: FilterGroup = {
  operator: 'AND',
  conditions: [{ field: 'volume_ratio', op: '>', value: 3 }],
};

describe('ScanExecutionService', () => {
  const makeService = (barsBySymbol: Map<string, Bar[]>) => {
    const dailyBars = {
      getLatestDailyBars: jest.fn().mockResolvedValue(barsBySymbol),
    };
    return {
      service: new ScanExecutionService(dailyBars as unknown as DailyBarsService),
      dailyBars,
    };
  };

  it('evaluates the DSL for every symbol with data and returns only matches', async () => {
    const { service } = makeService(
      new Map([
        ['AAPL', series('AAPL', 100, 400)], // ratio 4 → match
        ['MSFT', series('MSFT', 100, 100)], // ratio 1 → no match
      ]),
    );

    const result = await service.execute(VOLUME_SPIKE_DSL, ['AAPL', 'MSFT', 'NODATA']);

    expect(result.totalSymbols).toBe(3);
    expect(result.scannedSymbols).toBe(2); // NODATA has no bars
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.symbol).toBe('AAPL');
    expect(row.price).toBe(102);
    expect(row.volume).toBe(400);
    expect(row.volumeRatio).toBeCloseTo(4);
    expect(row.changePercent).toBeCloseTo(2);
    expect(row.values.volume_ratio).toBeCloseTo(4);
    expect(new Date(row.matchedAt).getTime()).not.toBeNaN();
  });

  it('requests bars in bulk for the whole requested universe', async () => {
    const { service, dailyBars } = makeService(new Map());
    await service.execute(VOLUME_SPIKE_DSL, ['AAPL', 'MSFT']);
    expect(dailyBars.getLatestDailyBars).toHaveBeenCalledTimes(1);
    expect(dailyBars.getLatestDailyBars).toHaveBeenCalledWith(['AAPL', 'MSFT']);
  });

  it('orders rows by volume ratio desc with a deterministic symbol tie-break', async () => {
    const { service } = makeService(
      new Map([
        ['ZZZ', series('ZZZ', 100, 400)],
        ['AAA', series('AAA', 100, 400)],
        ['MID', series('MID', 100, 600)],
      ]),
    );

    const result = await service.execute(VOLUME_SPIKE_DSL, ['ZZZ', 'AAA', 'MID']);

    expect(result.rows.map((r) => r.symbol)).toEqual(['MID', 'AAA', 'ZZZ']);
  });

  it('reports zero scanned symbols when no data is available at all', async () => {
    const { service } = makeService(new Map());
    const result = await service.execute(VOLUME_SPIKE_DSL, ['AAPL']);
    expect(result.scannedSymbols).toBe(0);
    expect(result.rows).toEqual([]);
  });
});

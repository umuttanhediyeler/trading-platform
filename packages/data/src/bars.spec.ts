import { describe, expect, it } from 'vitest';
import {
  OhlcvBar,
  groupBarsBySymbol,
  isSeriesUsable,
  normalizeBars,
  utcDayStart,
} from './bars';

const bar = (partial: Partial<OhlcvBar>): OhlcvBar => ({
  symbol: 'AAPL',
  timestamp: new Date('2026-07-01T00:00:00.000Z'),
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 1_000,
  ...partial,
});

describe('normalizeBars', () => {
  it('sorts ascending and de-duplicates by timestamp with last write winning', () => {
    const t1 = new Date('2026-07-01T00:00:00.000Z');
    const t2 = new Date('2026-07-02T00:00:00.000Z');
    const out = normalizeBars([
      bar({ timestamp: t2, close: 2 }),
      bar({ timestamp: t1, close: 1 }),
      bar({ timestamp: t2, close: 3 }),
    ]);
    expect(out.map((b) => b.timestamp)).toEqual([t1, t2]);
    expect(out[1]?.close).toBe(3);
  });

  it('drops invalid bars and uppercases symbols', () => {
    const out = normalizeBars([
      bar({ symbol: ' aapl ' }),
      bar({ open: NaN, timestamp: new Date('2026-07-02T00:00:00.000Z') }),
      bar({ close: 0, timestamp: new Date('2026-07-03T00:00:00.000Z') }),
      bar({ volume: -5, timestamp: new Date('2026-07-04T00:00:00.000Z') }),
      bar({ timestamp: new Date('invalid') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe('AAPL');
  });
});

describe('groupBarsBySymbol', () => {
  it('groups a flat list into normalized per-symbol series', () => {
    const grouped = groupBarsBySymbol([
      bar({ symbol: 'MSFT', timestamp: new Date('2026-07-02T00:00:00.000Z') }),
      bar({ symbol: 'aapl' }),
      bar({ symbol: 'MSFT', timestamp: new Date('2026-07-01T00:00:00.000Z') }),
    ]);
    expect([...grouped.keys()].sort()).toEqual(['AAPL', 'MSFT']);
    expect(grouped.get('MSFT')?.map((b) => b.timestamp.toISOString())).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
    ]);
  });

  it('omits symbols whose bars are all invalid', () => {
    const grouped = groupBarsBySymbol([bar({ symbol: 'BAD', open: NaN })]);
    expect(grouped.size).toBe(0);
  });
});

describe('utcDayStart', () => {
  it('truncates to UTC midnight', () => {
    expect(utcDayStart(new Date('2026-07-17T14:30:59.999Z')).toISOString()).toBe(
      '2026-07-17T00:00:00.000Z',
    );
  });
});

describe('isSeriesUsable', () => {
  const now = new Date('2026-07-10T00:00:00.000Z');
  const series = [
    bar({ timestamp: new Date('2026-07-07T00:00:00.000Z') }),
    bar({ timestamp: new Date('2026-07-08T00:00:00.000Z') }),
  ];

  it('requires minimum length and freshness', () => {
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    expect(isSeriesUsable(series, 2, twoDays, now)).toBe(true);
    expect(isSeriesUsable(series, 3, twoDays, now)).toBe(false);
    expect(isSeriesUsable(series, 2, twoDays - 1, now)).toBe(false);
    expect(isSeriesUsable([], 1, twoDays, now)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Ohlcv } from './bars';
import {
  gapPercent,
  lastCloseChangePercent,
  rsi,
  volumeRatio,
  vwapDistancePercent,
} from './indicators';

const flat = (close: number, volume = 1_000): Ohlcv => ({
  open: close,
  high: close,
  low: close,
  close,
  volume,
});

describe('volumeRatio', () => {
  it('compares the latest volume to the average of the prior window', () => {
    const bars = [flat(10, 100), flat(10, 100), flat(10, 300)];
    expect(volumeRatio(bars)).toBeCloseTo(3);
  });

  it('only uses the configured lookback', () => {
    const bars = [flat(10, 1_000_000), flat(10, 100), flat(10, 100), flat(10, 200)];
    expect(volumeRatio(bars, 2)).toBeCloseTo(2);
  });

  it('returns NaN for short series or zero average volume', () => {
    expect(volumeRatio([flat(10)])).toBeNaN();
    expect(volumeRatio([flat(10, 0), flat(10, 5)])).toBeNaN();
  });
});

describe('gapPercent', () => {
  it('computes the open-vs-previous-close gap', () => {
    const bars: Ohlcv[] = [flat(100), { ...flat(104), open: 104 }];
    expect(gapPercent(bars)).toBeCloseTo(4);
  });

  it('returns NaN for short series', () => {
    expect(gapPercent([flat(100)])).toBeNaN();
  });
});

describe('rsi', () => {
  it('is 100 when there are no losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes.map((c) => flat(c)))).toBe(100);
  });

  it('is near 0 for a monotonic decline', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(closes.map((c) => flat(c)))).toBeLessThan(1);
  });

  it('hovers near 50 for alternating equal gains/losses', () => {
    const closes = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const value = rsi(closes.map((c) => flat(c)));
    expect(value).toBeGreaterThan(45);
    expect(value).toBeLessThan(55);
  });

  it('returns NaN when the series is shorter than period + 1', () => {
    expect(rsi([flat(1), flat(2)])).toBeNaN();
  });
});

describe('vwapDistancePercent', () => {
  it('measures the latest close vs. typical-price VWAP', () => {
    // Single bar: VWAP = (high + low + close) / 3 = (110 + 90 + 105) / 3 = 101.666...
    const bars: Ohlcv[] = [
      { open: 100, high: 110, low: 90, close: 105, volume: 10 },
    ];
    expect(vwapDistancePercent(bars)).toBeCloseTo(((105 - 305 / 3) / (305 / 3)) * 100);
  });

  it('handles empty and zero-volume series', () => {
    expect(vwapDistancePercent([])).toBeNaN();
    expect(vwapDistancePercent([flat(100, 0)])).toBe(0);
  });
});

describe('lastCloseChangePercent', () => {
  it('computes change between the two most recent closes', () => {
    expect(lastCloseChangePercent([flat(100), flat(110)])).toBeCloseTo(10);
  });

  it('is 0 with a single bar (previous defaults to latest)', () => {
    expect(lastCloseChangePercent([flat(100)])).toBe(0);
  });
});

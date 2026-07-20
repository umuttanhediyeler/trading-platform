import { Bar } from '../src/market-data/providers/market-data-provider.interface';
import {
  FilterGroup,
  computeFields,
  countConditions,
  evaluateDSL,
  validateDSL,
} from '../src/scanner/filters/filter.types';
import { gapPercent } from '../src/scanner/filters/gap-up.filter';
import { rsi14 } from '../src/scanner/filters/rsi-threshold.filter';
import { volumeRatio } from '../src/scanner/filters/volume-spike.filter';

function makeBars(closes: number[], volumes?: number[]): Bar[] {
  return closes.map((close, i) => ({
    symbol: 'TEST',
    timestamp: new Date(2026, 0, 1 + i),
    open: i > 0 ? closes[i - 1] : close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: volumes?.[i] ?? 1_000_000,
  }));
}

describe('filter computations', () => {
  it('volumeRatio detects a 3x spike vs 20-bar average', () => {
    const volumes = [...Array(20).fill(1_000_000), 3_500_000];
    const bars = makeBars(Array(21).fill(100), volumes);
    expect(volumeRatio(bars)).toBeCloseTo(3.5, 5);
  });

  it('gapPercent measures open vs previous close', () => {
    const bars = makeBars([100, 100]);
    bars[1].open = 105;
    expect(gapPercent(bars)).toBeCloseTo(5, 5);
  });

  it('rsi14 is 100 for a monotonically rising series', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi14(makeBars(closes))).toBe(100);
  });

  it('rsi14 is low for a monotonically falling series', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi14(makeBars(closes))).toBeLessThan(5);
  });

  it('returns NaN when there is not enough history', () => {
    expect(rsi14(makeBars([100, 101]))).toBeNaN();
    expect(volumeRatio(makeBars([100]))).toBeNaN();
    expect(gapPercent(makeBars([100]))).toBeNaN();
  });
});

describe('filter DSL evaluation', () => {
  const values = { volume_ratio: 3.5, gap_percent: 5, rsi_14: 25 };

  it('evaluates the spec example DSL (AND with nested OR)', () => {
    const dsl: FilterGroup = {
      operator: 'AND',
      conditions: [
        { field: 'volume_ratio', op: '>', value: 3 },
        { field: 'gap_percent', op: '>', value: 4 },
        {
          operator: 'OR',
          conditions: [
            { field: 'rsi_14', op: '<', value: 30 },
            { field: 'price_vs_vwap', op: '<', value: -2 },
          ],
        },
      ],
    };
    expect(evaluateDSL(dsl, values)).toBe(true);
    expect(evaluateDSL(dsl, { ...values, volume_ratio: 2 })).toBe(false);
    // Nested OR: rsi fails but the unknown field also fails -> whole AND fails
    expect(evaluateDSL(dsl, { ...values, rsi_14: 50 })).toBe(false);
  });

  it('treats missing/NaN fields as non-matching', () => {
    const dsl: FilterGroup = {
      operator: 'AND',
      conditions: [{ field: 'rsi_14', op: '<', value: 30 }],
    };
    expect(evaluateDSL(dsl, {})).toBe(false);
    expect(evaluateDSL(dsl, { rsi_14: NaN })).toBe(false);
  });

  it('counts leaf conditions across nesting for plan limits', () => {
    const dsl: FilterGroup = {
      operator: 'AND',
      conditions: [
        { field: 'volume_ratio', op: '>', value: 3 },
        {
          operator: 'OR',
          conditions: [
            { field: 'rsi_14', op: '<', value: 30 },
            { field: 'gap_percent', op: '>', value: 4 },
          ],
        },
      ],
    };
    expect(countConditions(dsl)).toBe(3);
  });

  it('validateDSL flags unknown fields and operators', () => {
    const dsl = {
      operator: 'AND',
      conditions: [
        { field: 'nonexistent_field', op: '>', value: 1 },
        { field: 'rsi_14', op: '~=', value: 1 },
      ],
    } as unknown as FilterGroup;
    const errors = validateDSL(dsl);
    expect(errors).toHaveLength(2);
  });

  it('computeFields produces every registered field from bars', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
    const fields = computeFields(makeBars(closes));
    expect(Object.keys(fields).sort()).toEqual([
      'gap_percent',
      'price_vs_vwap',
      'rsi_14',
      'volume_ratio',
    ]);
  });
});

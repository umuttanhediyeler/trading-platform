import { Bar } from '../../market-data/providers/market-data-provider.interface';
import {
  computeFields,
  countConditions,
  evaluateDSL,
  validateDSL,
} from './filter.types';

const bars: Bar[] = Array.from({ length: 30 }, (_, index) => ({
  symbol: 'TEST',
  timestamp: new Date(2026, 0, index + 1),
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1_000 + index * 100,
}));

describe('scanner filter DSL', () => {
  it('computes every canonical field', () => {
    expect(Object.keys(computeFields(bars)).sort()).toEqual(
      ['gap_percent', 'price_vs_vwap', 'rsi_14', 'volume_ratio'].sort(),
    );
  });

  it('preserves and evaluates recursive AND/OR semantics', () => {
    const dsl = {
      operator: 'AND' as const,
      conditions: [
        { field: 'volume_ratio', op: '>=' as const, value: 1 },
        {
          operator: 'OR' as const,
          conditions: [
            { field: 'rsi_14', op: '==' as const, value: 50 },
            { field: 'gap_percent', op: '!=' as const, value: 99 },
          ],
        },
      ],
    };
    expect(validateDSL(dsl)).toEqual([]);
    expect(countConditions(dsl)).toBe(3);
    expect(evaluateDSL(dsl, computeFields(bars))).toBe(true);
  });

  it('rejects empty groups, unsupported fields, and invalid values', () => {
    expect(
      validateDSL({
        operator: 'AND',
        conditions: [
          { field: 'not_real', op: '>', value: Number.NaN },
          { operator: 'OR', conditions: [] },
        ],
      }),
    ).toEqual(expect.arrayContaining([
      "Unknown field 'not_real'",
      "Invalid value for 'not_real'",
      'Filter groups must contain at least one condition',
    ]));
  });
});

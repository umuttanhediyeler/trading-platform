import { gapPercent as sharedGapPercent } from '@trading-platform/data';
import { Bar } from '../../market-data/providers/market-data-provider.interface';

/**
 * gap_percent: percentage gap between the latest bar's open and the previous
 * bar's close. A value > 4 means the stock opened 4%+ above yesterday's close.
 *
 * Math lives in @trading-platform/data (shared semantics across consumers).
 */
export function gapPercent(bars: Bar[]): number {
  return sharedGapPercent(bars);
}

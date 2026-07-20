import { vwapDistancePercent } from '@trading-platform/data';
import { Bar } from '../../market-data/providers/market-data-provider.interface';

/**
 * price_vs_vwap: percentage distance of the latest close from the
 * volume-weighted average price of the series.
 *
 * Math lives in @trading-platform/data (shared semantics across consumers).
 */
export function priceVsVwap(bars: Bar[]): number {
  return vwapDistancePercent(bars);
}

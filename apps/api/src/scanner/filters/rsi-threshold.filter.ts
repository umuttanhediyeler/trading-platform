import { DEFAULT_RSI_PERIOD, rsi } from '@trading-platform/data';
import { Bar } from '../../market-data/providers/market-data-provider.interface';

/**
 * rsi_14: Wilder's RSI over the last 14 closes. Uses only past data —
 * the value at bar t depends solely on bars [0..t].
 *
 * Math lives in @trading-platform/data (shared semantics across consumers).
 */
export function rsi14(bars: Bar[]): number {
  return rsi(bars, DEFAULT_RSI_PERIOD);
}

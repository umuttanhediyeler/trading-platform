import { volumeRatio as sharedVolumeRatio } from '@trading-platform/data';
import { Bar } from '../../market-data/providers/market-data-provider.interface';

/**
 * volume_ratio: latest bar volume vs. the average volume of the previous
 * 20 bars (excluding the latest). > 3 means a 3x volume spike.
 *
 * Math lives in @trading-platform/data so every consumer (scanner, backtest
 * parity, web previews) shares the exact same semantics.
 */
export function volumeRatio(bars: Bar[]): number {
  return sharedVolumeRatio(bars);
}

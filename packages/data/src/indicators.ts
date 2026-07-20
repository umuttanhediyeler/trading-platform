/**
 * Pure indicator math over time-ordered bar series (oldest first).
 *
 * Every function only looks backwards in time and returns `NaN` when the
 * series is too short — callers treat `NaN` as "field unavailable".
 *
 * These are the single source of truth for the scanner's field registry
 * (apps/api/src/scanner/filters) and any other consumer needing the same
 * semantics (backtest parity, web previews, ...).
 */
import { Ohlcv } from './bars';

export const DEFAULT_VOLUME_LOOKBACK = 20;
export const DEFAULT_RSI_PERIOD = 14;

/**
 * Latest bar volume vs. the average volume of the previous `lookback` bars
 * (excluding the latest). A value > 3 means a 3x volume spike.
 */
export function volumeRatio(
  bars: readonly Ohlcv[],
  lookback: number = DEFAULT_VOLUME_LOOKBACK,
): number {
  if (bars.length < 2) return NaN;
  const latest = bars[bars.length - 1]!;
  const window = bars.slice(
    Math.max(0, bars.length - 1 - lookback),
    bars.length - 1,
  );
  const avg = window.reduce((sum, b) => sum + b.volume, 0) / window.length;
  if (!avg) return NaN;
  return latest.volume / avg;
}

/**
 * Percentage gap between the latest bar's open and the previous bar's close.
 * A value > 4 means the instrument opened 4%+ above the prior close.
 */
export function gapPercent(bars: readonly Ohlcv[]): number {
  if (bars.length < 2) return NaN;
  const prevClose = bars[bars.length - 2]!.close;
  const open = bars[bars.length - 1]!.open;
  if (!prevClose) return NaN;
  return ((open - prevClose) / prevClose) * 100;
}

/**
 * Wilder's RSI over closes. The value at bar t depends solely on bars [0..t].
 */
export function rsi(
  bars: readonly Ohlcv[],
  period: number = DEFAULT_RSI_PERIOD,
): number {
  if (bars.length < period + 1) return NaN;

  const closes = bars.map((b) => b.close);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Percentage distance of the latest close from the volume-weighted average
 * price (typical price (H+L+C)/3 weighted by volume over the whole series).
 */
export function vwapDistancePercent(bars: readonly Ohlcv[]): number {
  if (bars.length === 0) return NaN;
  let weightedPrice = 0;
  let volume = 0;
  for (const bar of bars) {
    weightedPrice += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    volume += bar.volume;
  }
  if (volume <= 0) return 0;
  const vwap = weightedPrice / volume;
  const lastClose = bars[bars.length - 1]!.close;
  return vwap === 0 ? 0 : ((lastClose - vwap) / vwap) * 100;
}

/**
 * Percentage change between the last two closes — the scanner's
 * "change %" column.
 */
export function lastCloseChangePercent(bars: readonly Ohlcv[]): number {
  if (bars.length === 0) return NaN;
  const last = bars[bars.length - 1]!;
  const prev = bars[bars.length - 2] ?? last;
  if (prev.close <= 0) return 0;
  return ((last.close - prev.close) / prev.close) * 100;
}

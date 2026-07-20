/**
 * Canonical OHLCV bar shapes shared across services.
 *
 * `OhlcvBar` is structurally compatible with the API's internal
 * `Bar` interface (apps/api market-data providers), so values can flow
 * between the two without mapping.
 */

/** Price/volume payload of a single bar, without identity fields. */
export interface Ohlcv {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A full bar: symbol + timestamp + OHLCV. */
export interface OhlcvBar extends Ohlcv {
  symbol: string;
  timestamp: Date;
}

function isValidBar(bar: OhlcvBar): boolean {
  return (
    typeof bar.symbol === 'string' &&
    bar.symbol.trim().length > 0 &&
    bar.timestamp instanceof Date &&
    Number.isFinite(bar.timestamp.getTime()) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    Number.isFinite(bar.volume) &&
    bar.open > 0 &&
    bar.high > 0 &&
    bar.low > 0 &&
    bar.close > 0 &&
    bar.volume >= 0
  );
}

/**
 * Normalizes a raw bar series into the canonical form indicators expect:
 * - drops bars with non-finite/non-positive prices, negative volume, or
 *   invalid timestamps;
 * - uppercases and trims the symbol;
 * - sorts ascending by timestamp;
 * - de-duplicates by timestamp (the last occurrence wins, matching
 *   "latest write wins" upsert semantics).
 */
export function normalizeBars(bars: readonly OhlcvBar[]): OhlcvBar[] {
  const byTime = new Map<number, OhlcvBar>();
  for (const bar of bars) {
    if (!isValidBar(bar)) continue;
    byTime.set(bar.timestamp.getTime(), {
      ...bar,
      symbol: bar.symbol.trim().toUpperCase(),
    });
  }
  return [...byTime.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
}

/**
 * Groups a flat multi-symbol bar list into per-symbol, normalized
 * (validated, sorted, de-duplicated) series.
 */
export function groupBarsBySymbol(
  bars: readonly OhlcvBar[],
): Map<string, OhlcvBar[]> {
  const raw = new Map<string, OhlcvBar[]>();
  for (const bar of bars) {
    const symbol = bar.symbol?.trim().toUpperCase();
    if (!symbol) continue;
    const list = raw.get(symbol);
    if (list) list.push(bar);
    else raw.set(symbol, [bar]);
  }
  const grouped = new Map<string, OhlcvBar[]>();
  for (const [symbol, list] of raw) {
    const normalized = normalizeBars(list);
    if (normalized.length > 0) grouped.set(symbol, normalized);
  }
  return grouped;
}

/** Truncates a timestamp to UTC midnight — the canonical daily-bar bucket. */
export function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * True when a (normalized, ascending) series is usable for scanning:
 * it has at least `minBars` bars and its newest bar is no older than
 * `maxAgeMs` relative to `now`.
 */
export function isSeriesUsable(
  bars: readonly OhlcvBar[],
  minBars: number,
  maxAgeMs: number,
  now: Date = new Date(),
): boolean {
  if (bars.length < minBars) return false;
  const latest = bars[bars.length - 1];
  if (!latest) return false;
  return now.getTime() - latest.timestamp.getTime() <= maxAgeMs;
}

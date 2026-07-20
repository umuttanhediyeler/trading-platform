# @trading-platform/data

Shared, framework-free market-data utilities used by `apps/api` (and any
future consumer that needs identical semantics — web previews, scripts,
backtest parity checks).

## What lives here

### Bar normalization (`src/bars.ts`)

- `Ohlcv` / `OhlcvBar` — canonical OHLCV shapes, structurally compatible with
  the API's internal `Bar` interface (no mapping needed).
- `normalizeBars(bars)` — drops invalid bars (non-finite/non-positive prices,
  negative volume, invalid timestamps), uppercases symbols, sorts ascending,
  de-duplicates by timestamp (last write wins).
- `groupBarsBySymbol(bars)` — flat multi-symbol list → per-symbol normalized
  series (`Map<string, OhlcvBar[]>`).
- `utcDayStart(date)` — truncates to UTC midnight, the canonical daily-bar
  bucket in the TimescaleDB `bars` hypertable.
- `isSeriesUsable(bars, minBars, maxAgeMs, now?)` — coverage + freshness check
  used to decide whether a DB series is scan-ready or needs a provider refresh.

### Indicator math (`src/indicators.ts`)

Pure functions over time-ordered bars (oldest first); they only look backwards
in time and return `NaN` when the series is too short:

- `volumeRatio(bars, lookback = 20)`
- `gapPercent(bars)`
- `rsi(bars, period = 14)` — Wilder's RSI
- `vwapDistancePercent(bars)`
- `lastCloseChangePercent(bars)`

These are the single source of truth for the scanner's field registry
(`apps/api/src/scanner/filters/*` delegate to them), so scan results, previews
and any offline analysis share exactly the same numbers.

### Batch/rate-limit primitives (`src/batching.ts`)

Provider-safe bulk fetch building blocks:

- `chunk(items, size)` — consecutive slices (e.g. 100 symbols per multi-symbol
  bars request).
- `mapWithConcurrency(items, concurrency, fn)` — bounded-parallel map that
  never rejects; each item yields an `{ ok, value | error }` record in input
  order, so one failing symbol can't sink a 500-symbol scan.
- `RateLimiter({ maxRequests, perMs })` — sliding-window limiter;
  `await limiter.acquire()` before every provider request keeps bulk scans
  inside vendor quotas.

## How the API uses it

- `apps/api/src/market-data/daily-bars.service.ts` — bulk "latest N daily
  bars" reads from TimescaleDB with a batched, rate-limited provider fallback
  and write-through persistence.
- `apps/api/src/scanner/scan-execution.service.ts` — evaluates scan DSLs over
  the 500+ symbol `SCAN_UNIVERSE` using the bulk loader.
- `apps/api/src/market-data/providers/alpaca.provider.ts` — chunks Alpaca's
  multi-symbol bars endpoint.
- `apps/api/src/market-data/ingestion.worker.ts` — nightly daily-bar backfill
  for the whole scan universe.

## Development

```bash
pnpm --filter @trading-platform/data build   # tsc → dist/
pnpm --filter @trading-platform/data lint    # tsc --noEmit (includes specs)
pnpm --filter @trading-platform/data test    # vitest
```

The package ships CommonJS output (`dist/`) so both the NestJS API (CJS) and
Next.js can consume it. Keep it dependency-free and framework-free.

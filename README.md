# Trading Platform

AI-assisted stock **scanning & signal** platform. A monorepo containing a
Next.js web app, a NestJS API, two Python microservices (ML + backtest), and
shared TypeScript contracts.

> This repository is under active construction. The two source-of-truth specs
> live one directory up: `cursor_master_prompt.md` (phase roadmap — *what* to
> build) and `cursor_detailed_spec.md` (detailed structure — *how* to build it).

---

## ⚠️ Scope & risk disclaimer

**Read this before connecting any brokerage account or enabling automation.**

- **Not real-time, exchange-licensed data.** The default and development mode
  uses **delayed / free market data**. Do not rely on it for time-sensitive
  trading decisions.
- **Simulation first.** The default operating mode is a **paper-trading
  simulation account** with no real money at risk.
- **Real-money automated trading is opt-in and explicit.** It requires the user
  to deliberately connect their own brokerage account **and** review and approve
  hard risk limits (max daily trades, max daily loss, max risk per trade). Full
  automatic mode only activates after passing a risk-acknowledgement screen and
  is protected by an always-accessible **kill switch**.
- **Not financial advice.** Signals, scans, and backtests are statistical tools,
  not recommendations. Backtested performance does not guarantee future results.
  You are solely responsible for your trades and for complying with the laws,
  regulations, and market-data licensing terms in your jurisdiction.
- **No warranty.** The software is provided "as is", without warranty of any
  kind. The authors are not liable for any financial loss.

---

## Architecture

```
        Browser
           │
           ▼
   ┌───────────────┐         ┌────────────────────────────────┐
   │  apps/web     │  HTTPS  │  apps/api (NestJS)             │
   │  Next.js      │────────▶│  REST + Socket.IO              │
   │  (Vercel)     │  WSS    │  (Koyeb / Render)              │
   └───────────────┘         └───┬──────────┬──────────┬──────┘
                                 │          │          │
                    DATABASE_URL │          │ HTTP     │ REDIS_URL
                                 ▼          ▼          ▼
                          Supabase/Neon   ML + BT    Upstash
                          (Postgres)    (Koyeb)     (Redis)
```

**Golden rule:** `apps/web` never talks to Postgres, Redis, or the Python
services directly — it always goes through `apps/api`, so entitlement checks
(e.g. Free users can't reach AI signals) are enforced in exactly one place.

**Deploy targets:** Vercel (web) · Koyeb/Render (api, ml, backtest) ·
Supabase/Neon (Postgres) · Upstash (Redis). Each backend service has its own
`Dockerfile` and binds to the platform-injected `$PORT`.

---

## Packages & responsibilities

| Path | Stack | Responsibility |
|---|---|---|
| `apps/web` | Next.js 14, Tailwind, shadcn/ui | Frontend: landing, auth, dashboard, scanner, signals, backtest, simulation, settings. Type-safe API/WS clients. |
| `apps/api` | NestJS 10, Prisma, BullMQ | Backend: auth, Stripe billing, market-data ingestion, scanner, signals, backtest proxy, simulation, execution/risk, broker adapters. Owns DB migrations & job scheduling. |
| `packages/shared-types` | TypeScript | Single source of truth for cross-service contracts (`Signal`, `Scan`, `Subscription`). Imported by web + api. |
| `packages/data` | TypeScript | Shared market-data utilities: bar normalization, indicator math (RSI, VWAP, volume ratio, gap %), chunking, bounded concurrency and rate limiting for provider-safe bulk scans. Imported by api. |
| `packages/ml` | Python, FastAPI, LightGBM | AI signal engine: feature engineering, triple-barrier labeling, walk-forward training, nightly strategy selection, model registry. Ships with **look-ahead bias tests**. |
| `packages/backtest` | Python, FastAPI, vectorbt | Strategy backtesting: return curve, Sharpe, drawdown, expectancy, profit factor. |
| `infra` | Optional assets | `postgres/init.sql` (Timescale helper), Prometheus/Grafana configs — not required for PaaS deploy. |

### `packages/shared-types` layout

```
packages/shared-types/
├── src/
│   ├── signal.ts         # Signal, SignalStatus, SignalNewEvent
│   ├── scan.ts           # ScanFilter, ScanCondition, ScanDefinition, ScanRow, ScanResult
│   ├── subscription.ts   # PlanTier, SubscriptionStatus, Subscription, Entitlement(Key)
│   └── index.ts          # re-exports
├── package.json
└── tsconfig.json         # extends ../../tsconfig.base.json, emits ./dist
```

---

## Plans (entitlements)

| Feature | Free | Basic | Premium |
|---|---|---|---|
| Data latency | 15 min delayed | Real-time | Real-time |
| Scan filter count | 5 | Unlimited | Unlimited |
| AI signal engine | ❌ | ❌ | ✅ |
| Backtest | ❌ | Limited | Unlimited |
| Simulation account | ✅ | ✅ | ✅ |
| One-click trade | ❌ | ✅ | ✅ |
| Full auto trade | ❌ | ❌ | ✅ (risk-approved) |
| Broker integration | ❌ | ✅ | ✅ |

---

## Local development setup

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **Python** ≥ 3.11 (for `packages/ml` and `packages/backtest`)
- **Postgres** (local install, Docker image, or a free Neon/Supabase project)
- **Redis** (local install, Docker image, or a free Upstash database)

### 1. Install JS/TS dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/ml/.env.example packages/ml/.env
cp packages/backtest/.env.example packages/backtest/.env
```

Point `DATABASE_URL` / `REDIS_URL` at your local or managed instances. See
root `.env.example` for the full catalog.

### 3. Build shared types & migrate

```bash
pnpm --filter @trading-platform/shared-types build
cd apps/api && pnpm exec prisma migrate deploy && cd ../..
```

### 4. Run services (separate terminals)

```bash
pnpm --filter @trading-platform/api dev          # :3001
pnpm --filter @trading-platform/web dev          # :3000
# ML / backtest (from their package dirs), e.g.:
#   uv run --env-file .env uvicorn app.main:app --port 8001
#   uv run --env-file .env uvicorn app.main:app --port 8002
```

Or `pnpm dev` from the repo root (Turbo runs web + api when those scripts exist).

### Useful monorepo scripts

```bash
pnpm build          # turbo build across all packages
pnpm lint           # turbo lint
pnpm test           # turbo test
```

---

## Model lifecycle and observability

- Weekly retraining runs Sunday at 23:00 and always registers new models in
  **shadow** mode.
- During every intraday signal cycle, shadow candidates are scored on the same
  bars as the champion. Their hidden predictions become `ShadowEvaluation`
  paper trades that are resolved with the same barrier logic — never emitted
  over WebSocket, never shown to users, never opening simulated orders.
- The weekday lifecycle pass compares challengers with the active champion on
  offline metrics, then applies live soak gates before promotion: minimum
  shadow age (`MODEL_MIN_SOAK_HOURS`, clamped to ≥ 24h so weekly retrains can
  never be promoted the same day), minimum resolved hidden samples
  (`MODEL_MIN_SHADOW_SAMPLES`), and a live shadow hit rate at least matching
  the champion's. It also applies quality gates, rolls back weak champions
  (restarting their soak clock), and retrains on drift.
- The Models page plots offline/backtest expectancy against resolved
  live/simulation signal returns over time.
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` enable API and web error capture.
- `ALERT_WEBHOOK_URL` receives structured critical execution errors, model
  drift, promotion, and rollback events (Slack/Discord-compatible payload).

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push / pull request:

- **TypeScript job**: `pnpm install` → `pnpm lint` → `pnpm test` → `pnpm build`.
- **Python job**: installs `packages/ml` and runs the **leakage tests**
  (`test_leakage.py`) — the look-ahead-bias guard that must stay green before
  any signal code reaches production.

---

## Build order

Follow the phased order in `cursor_master_prompt.md` (FAZ 0 → 10) and the
implementation order in `cursor_detailed_spec.md` §10. In particular: **do not
ship signal generation until `packages/ml`'s leakage tests pass.**

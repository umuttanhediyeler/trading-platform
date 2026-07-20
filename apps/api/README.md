# apps/api — NestJS Backend

Backend for the AI stock scanning & signal platform. Postgres (Prisma) +
Redis (quote cache, BullMQ) + Socket.IO on the `/ws` namespace.

## Setup

```bash
cp .env.example .env        # fill in secrets
npm install
npx prisma migrate dev      # requires Postgres from infra/docker-compose.yml
npx prisma db seed          # seeds the Entitlement table for free/basic/premium
npm run start:dev           # http://localhost:3001
```

Set `DISABLE_WORKERS=true` to boot without Redis (disables BullMQ workers).

## Modules

| Module | Routes / responsibility |
|---|---|
| auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (JWT 15m access, 7d refresh in httpOnly cookie), `EntitlementGuard` + `@RequiresEntitlement` |
| users | `GET /users/me` |
| billing | `POST /billing/checkout`, `POST /billing/portal`, `POST /webhooks/stripe` (signature-verified) |
| market-data | Polygon/Alpha Vantage providers, Redis quote cache (2s TTL + stale fallback), BullMQ ingestion worker |
| scanner | `GET/POST /scans`, `POST /scans/:id/run`, `GET /scans/templates`, filter DSL + 12 templates, `scan:result` WS push |
| signals | `GET /signals` (Premium only), `signal:new` WS push, ML bridge + nightly BullMQ job (`0 22 * * 1-5`) |
| backtest | `POST /backtest/run` → Python backtest service proxy |
| simulation | `GET /simulation/account`, `POST /simulation/orders`, auto sim-execution worker |
| execution | `POST /execution/mode`, `POST/DELETE /execution/kill-switch`, risk guard (daily trade/loss limits) |
| broker | `POST /broker/connect` (AES-256-GCM encrypted keys, paper default), `GET /broker/positions`, `POST /broker/orders` (idempotency key) |

## Tests

```bash
npm test
```

Covers: Free-user 403 on `/signals`, Stripe webhook signature verification,
filter DSL evaluation, AES-256-GCM round-trip/tamper detection, risk-guard
kill switch behavior. Tests mock Prisma — no database required.

# Apex Scan — Web (`apps/web`)

Next.js 14 App Router frontend for the trading platform.

## Stack

- Next.js 14 + React 18 + TypeScript
- Tailwind CSS (dark-first)
- NextAuth credentials → backend `/auth/login`
- socket.io-client → `NEXT_PUBLIC_WS_URL/ws`
- lightweight-charts, TanStack Table, Zustand, Zod

## Setup

```bash
cp .env.local.example .env.local
pnpm install
pnpm dev
```

## Scripts

- `pnpm dev` — development server on :3000
- `pnpm build` / `pnpm start` — production
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — ESLint

## Notes

- Web talks only to `apps/api` (HTTP + WebSocket), never DB/Redis/ML directly.
- UI includes representative demo data with explicit “not live” labels when the API is offline.
- Kill switch is always visible in the app shell top bar.

# syntax=docker/dockerfile:1
# Build context = monorepo root. Built on GitHub Actions (not Render Free).

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/data/package.json ./packages/data/package.json
# Lock may lag package.json during PaaS iteration; Actions has enough RAM.
RUN pnpm install --no-frozen-lockfile --filter @trading-platform/api...

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
WORKDIR /app
RUN pnpm --filter @trading-platform/shared-types build \
 && pnpm --filter @trading-platform/data build \
 && pnpm --filter @trading-platform/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN apk add --no-cache openssl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/data ./packages/data
COPY --from=builder /app/packages/shared-types ./packages/shared-types
USER nestjs
EXPOSE 3001
# Migrations already applied on Supabase; boot the API only.
CMD ["node", "dist/main.js"]

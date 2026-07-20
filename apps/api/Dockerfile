# syntax=docker/dockerfile:1
# Built on GitHub Actions. Runtime targets Render Free (512MB).

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/data/package.json ./packages/data/package.json
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
 && pnpm --filter @trading-platform/api build \
 && pnpm --filter @trading-platform/api deploy --prod /deploy \
 && cp -R apps/api/prisma /deploy/prisma \
 && cp -R apps/api/dist /deploy/dist

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# Keep Nest under Render Free 512MB.
ENV NODE_OPTIONS=--max-old-space-size=384
ENV DISABLE_WORKERS=true
RUN apk add --no-cache openssl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /deploy ./
USER nestjs
EXPOSE 3001
CMD ["node", "dist/main.js"]

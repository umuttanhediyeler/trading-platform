import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness — process is up. */
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', ts: new Date().toISOString() };
  }

  /**
   * Readiness — Postgres, Redis, and (best-effort) ML/backtest dependencies.
   * Returns 503 if a hard dependency is down.
   */
  @Get('ready')
  async ready() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = { ok: true };
    } catch (err) {
      checks.postgres = { ok: false, detail: (err as Error).message };
    }

    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (err) {
      checks.redis = { ok: false, detail: (err as Error).message };
    } finally {
      await redis.quit().catch(() => undefined);
    }

    checks.ml = await this.probe(
      this.config.get<string>('ML_SERVICE_URL', 'http://localhost:8001') +
        '/health',
    );
    checks.backtest = await this.probe(
      this.config.get<string>('BACKTEST_SERVICE_URL', 'http://localhost:8002') +
        '/health',
    );

    const hardOk = checks.postgres.ok && checks.redis.ok;
    const body = {
      status: hardOk ? 'ready' : 'not_ready',
      checks,
      ts: new Date().toISOString(),
    };
    if (!hardOk) {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async probe(url: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

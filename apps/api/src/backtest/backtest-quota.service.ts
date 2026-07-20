import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { EntitlementsService } from '../auth/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

export interface BacktestQuota {
  limit: number | null;
  used: number;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class BacktestQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async getQuota(userId: string, planTier: string): Promise<BacktestQuota> {
    const { periodStart, periodEnd } = this.currentPeriod();
    const limit = await this.entitlements.getLimit(
      planTier,
      'backtest_monthly_limit',
    );
    const used = await this.prisma.backtestQuotaLedger.count({
      where: { userId, periodStart },
    });

    if (!Number.isFinite(limit)) {
      return { limit: null, used, remaining: null, periodStart, periodEnd };
    }
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      periodStart,
      periodEnd,
    };
  }

  async reserve(
    userId: string,
    planTier: string,
    request: { strategyId: string; symbol: string },
  ): Promise<string | null> {
    const limit = await this.entitlements.getLimit(
      planTier,
      'backtest_monthly_limit',
    );
    if (!Number.isFinite(limit)) return null;

    const { periodStart } = this.currentPeriod();
    return this.prisma.$transaction(async (tx) => {
      // Serialize reservations for one user/month. A count followed by insert
      // without this lock allows concurrent requests to exceed the quota.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${userId}),
          hashtext(${periodStart.toISOString()})
        )
      `;
      const used = await tx.backtestQuotaLedger.count({
        where: { userId, periodStart },
      });
      if (limit <= 0 || used >= limit) {
        throw new HttpException(
          `Monthly backtest quota reached (${limit}). Quota resets at the start of next month (UTC).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const reservation = await tx.backtestQuotaLedger.create({
        data: {
          userId,
          periodStart,
          strategyId: request.strategyId,
          symbol: request.symbol.toUpperCase(),
        },
      });
      return reservation.id;
    });
  }

  async complete(reservationId: string | null): Promise<void> {
    if (!reservationId) return;
    await this.prisma.backtestQuotaLedger.update({
      where: { id: reservationId },
      data: { status: 'completed', failureReason: null },
    });
  }

  async fail(reservationId: string | null, error: unknown): Promise<void> {
    if (!reservationId) return;
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.backtestQuotaLedger.update({
      where: { id: reservationId },
      data: { status: 'failed', failureReason: message.slice(0, 1000) },
    });
  }

  private currentPeriod(now = new Date()) {
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return { periodStart, periodEnd };
  }
}

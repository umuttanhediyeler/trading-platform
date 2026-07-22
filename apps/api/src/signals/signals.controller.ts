import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequiresEntitlement } from '../common/decorators/requires-entitlement.decorator';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { inferSignalSide } from '../execution/risk-targets';

/**
 * AI signals feed — Premium only. A Free/Basic user hitting this endpoint
 * gets a 403 from EntitlementGuard (covered by an automated test).
 */
@Controller('signals')
@UseGuards(JwtAuthGuard, EntitlementGuard)
@RequiresEntitlement('ai_signals_enabled')
export class SignalsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary() {
    const [open, hitTarget, hitStop, expired, latestResolved] =
      await Promise.all([
        this.prisma.signal.count({ where: { status: 'open' } }),
        this.prisma.signal.count({ where: { status: 'hit_target' } }),
        this.prisma.signal.count({ where: { status: 'hit_stop' } }),
        this.prisma.signal.count({ where: { status: 'expired' } }),
        this.prisma.signal.findMany({
          where: { status: { in: ['hit_target', 'hit_stop', 'expired'] } },
          orderBy: { resolvedAt: 'desc' },
          take: 100,
          select: { realizedReturn: true },
        }),
      ]);
    const directional = hitTarget + hitStop;
    const returns = latestResolved
      .map((signal) => signal.realizedReturn)
      .filter((value): value is number => value !== null);
    return {
      open,
      hitTarget,
      hitStop,
      expired,
      resolved: hitTarget + hitStop + expired,
      hitRate: directional > 0 ? hitTarget / directional : null,
      averageReturn:
        returns.length > 0
          ? returns.reduce((sum, value) => sum + value, 0) / returns.length
          : null,
    };
  }

  @Get()
  async list(@Query('status') status = 'open', @Query('limit') limit?: string) {
    const allowed = ['open', 'hit_target', 'hit_stop', 'expired', 'all'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`status must be one of: ${allowed.join(', ')}`);
    }
    const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = await this.prisma.signal.findMany({
      where: status === 'all' ? undefined : { status },
      orderBy: { generatedAt: 'desc' },
      take,
    });
    return rows.map((s) => {
      const entryPrice = Number(s.entryPrice);
      const stopPrice = Number(s.stopPrice);
      const targetPrice = Number(s.targetPrice);
      return {
        id: s.id,
        symbol: s.symbol,
        strategyId: s.strategyId,
        entryPrice,
        stopPrice,
        targetPrice,
        side: inferSignalSide(entryPrice, stopPrice, targetPrice),
        confidence: s.confidence,
        generatedAt: s.generatedAt.toISOString(),
        status: s.status,
        resolvedAt: s.resolvedAt?.toISOString() ?? null,
        resolvedPrice:
          s.resolvedPrice === null ? null : Number(s.resolvedPrice),
        realizedReturn: s.realizedReturn,
        modelVersion: s.modelVersion,
      };
    });
  }
}

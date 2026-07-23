import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresEntitlement } from '../common/decorators/requires-entitlement.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MlBridgeService } from '../signals/ml-bridge.service';
import { computeBrier, computeDrift, extractFeatureRows } from './drift';
import { ModelLifecycleService } from './model-lifecycle.service';

/**
 * Model registry / performance surface for the Premium dashboard.
 * Proxies ML /models (web never talks to Python directly).
 */
@Controller('models')
@UseGuards(JwtAuthGuard, EntitlementGuard)
@RequiresEntitlement('ai_signals_enabled')
export class ModelsController {
  constructor(
    private readonly ml: MlBridgeService,
    private readonly prisma: PrismaService,
    private readonly lifecycle: ModelLifecycleService,
  ) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const models = await this.prisma.modelRegistry.findMany({
      orderBy: { trainedAt: 'desc' },
      take,
      include: {
        performance: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
      },
    });
    const snapshots = await this.prisma.modelPerformanceSnapshot.findMany({
      orderBy: { calculatedAt: 'desc' },
      take: 120,
      include: {
        model: {
          select: {
            expectancy: true,
            regime: true,
            isActive: true,
          },
        },
      },
    });
    const openSignals = await this.prisma.signal.count({ where: { status: 'open' } });
    // Decisive outcomes only — expired rows used to crowd the window and made
    // hitRate look like ~10% with a tiny TP/SL denominator.
    const resolved = await this.prisma.signal.findMany({
      where: { status: { in: ['hit_target', 'hit_stop'] } },
      orderBy: { resolvedAt: 'desc' },
      take: 100,
    });
    const hits = resolved.filter((s) => s.status === 'hit_target').length;
    const stops = resolved.filter((s) => s.status === 'hit_stop').length;
    // Drift still needs recent feature rows (labels optional).
    const recentForDrift = await this.prisma.prediction.findMany({
      where: { fallback: false, shadow: false },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { features: true },
    });
    // Brier needs actualLabel — newest unlabeled predictions are useless here.
    const labeledPredictions = await this.prisma.prediction.findMany({
      where: {
        fallback: false,
        shadow: false,
        actualLabel: { not: null },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 200,
      select: {
        features: true,
        probabilities: true,
        actualLabel: true,
      },
    });
    const drift = computeDrift(extractFeatureRows(recentForDrift));
    const calibration = computeBrier(labeledPredictions);

    // Shadow soak status per challenger, computed over the current soak
    // window only (post-rollback resets discard stale history).
    const shadowRows = await this.prisma.shadowEvaluation.findMany({
      orderBy: { generatedAt: 'desc' },
      take: 1000,
      select: {
        modelVersion: true,
        status: true,
        realizedReturn: true,
        generatedAt: true,
      },
    });
    const gates = this.lifecycle.promotionGateConfig();
    const shadowSoakFor = (model: {
      version: string;
      status: string;
      isActive: boolean;
      trainedAt: Date;
      shadowStartedAt: Date | null;
    }) => {
      if (model.isActive || model.status !== 'shadow') return null;
      const soakStart = model.shadowStartedAt ?? model.trainedAt;
      const rows = shadowRows.filter(
        (row) =>
          row.modelVersion === model.version && row.generatedAt >= soakStart,
      );
      const wins = rows.filter((row) => row.status === 'hit_target').length;
      const losses = rows.filter((row) => row.status === 'hit_stop').length;
      const open = rows.filter((row) => row.status === 'open').length;
      const returns = rows
        .map((row) => row.realizedReturn)
        .filter((value): value is number => value !== null);
      const soakAgeHours = (Date.now() - soakStart.getTime()) / 3_600_000;
      return {
        soakStartedAt: soakStart,
        soakAgeHours,
        openEvaluations: open,
        resolvedSamples: wins + losses,
        hitRate: wins + losses > 0 ? wins / (wins + losses) : null,
        averageReturn:
          returns.length > 0
            ? returns.reduce((sum, value) => sum + value, 0) / returns.length
            : null,
        soakAgeSatisfied: soakAgeHours >= gates.minSoakHours,
        samplesSatisfied: wins + losses >= gates.minShadowSamples,
      };
    };

    return {
      soakGates: gates,
      models: models.map(({ performance, ...model }) => ({
        ...model,
        latestPerformance: performance[0] ?? null,
        shadowSoak: shadowSoakFor(model),
      })),
      performance: {
        openSignals,
        resolved: resolved.length,
        hitTarget: hits,
        hitStop: stops,
        hitRate: hits + stops > 0 ? hits / (hits + stops) : null,
        calibration,
        drift,
      },
      timeline: [...snapshots].reverse().map(({ model, ...snapshot }) => ({
        modelVersion: snapshot.modelVersion,
        calculatedAt: snapshot.calculatedAt,
        expectedReturn: model.expectancy,
        actualReturn: snapshot.averageReturn,
        hitRate: snapshot.hitRate,
        sampleSize: snapshot.sampleSize,
        regime: model.regime,
        isChampion: model.isActive,
      })),
    };
  }

  @Post('generate-signals')
  generate() {
    return this.ml.enqueueGenerateSignals();
  }

  @Post('resolve-signals')
  async resolve() {
    const signals = await this.ml.resolveOpenSignals();
    const shadow = await this.ml.resolveShadowEvaluations();
    return { ...signals, shadowResolved: shadow.resolved };
  }

  @Post(':version/promote')
  promote(@Param('version') version: string) {
    return this.ml.promoteModel(version);
  }

  /** Manually run the champion–challenger lifecycle pass. */
  @Post('lifecycle/run')
  runLifecycle() {
    return this.lifecycle.runLifecycle();
  }
}

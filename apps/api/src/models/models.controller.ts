import {
  Controller,
  Get,
  OnModuleInit,
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
export class ModelsController implements OnModuleInit {
  /** Cross-region Postgres RTTs make a cold /models ~8–16s; keep a warm cache. */
  private listCache: { at: number; body: unknown } | null = null;
  private static readonly LIST_TTL_MS = 45_000;
  private warming = false;

  constructor(
    private readonly ml: MlBridgeService,
    private readonly prisma: PrismaService,
    private readonly lifecycle: ModelLifecycleService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.warmListCache(), 4_000);
    setInterval(() => void this.warmListCache(), 30_000);
  }

  private async warmListCache() {
    if (this.warming) return;
    this.warming = true;
    try {
      await this.buildListPayload(40);
    } catch {
      // Boot/network blips — next interval retries.
    } finally {
      this.warming = false;
    }
  }

  @Get()
  async list(@Query('limit') limit?: string) {
    const now = Date.now();
    if (
      this.listCache &&
      now - this.listCache.at < ModelsController.LIST_TTL_MS
    ) {
      return this.listCache.body;
    }
    const take = Math.min(Math.max(Number(limit) || 40, 1), 80);
    return this.buildListPayload(take);
  }

  private async buildListPayload(take: number) {
    const gates = this.lifecycle.promotionGateConfig();

    const [
      models,
      snapshots,
      openSignals,
      resolved,
      recentForDrift,
      labeledPredictions,
    ] = await Promise.all([
      this.prisma.modelRegistry.findMany({
        where: { status: { in: ['active', 'shadow', 'rejected'] } },
        orderBy: [{ isActive: 'desc' }, { trainedAt: 'desc' }],
        take,
        select: {
          id: true,
          version: true,
          trainedAt: true,
          precision: true,
          recall: true,
          expectancy: true,
          maxDrawdown: true,
          regime: true,
          isActive: true,
          status: true,
          artifactPath: true,
          artifactSha256: true,
          trainingSamples: true,
          promotedAt: true,
          promotionReason: true,
          shadowStartedAt: true,
          performance: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.modelPerformanceSnapshot.findMany({
        orderBy: { calculatedAt: 'desc' },
        take: 40,
        include: {
          model: {
            select: {
              expectancy: true,
              regime: true,
              isActive: true,
            },
          },
        },
      }),
      this.prisma.signal.count({ where: { status: 'open' } }),
      this.prisma.signal.findMany({
        where: { status: { in: ['hit_target', 'hit_stop'] } },
        orderBy: { resolvedAt: 'desc' },
        take: 100,
        select: { status: true },
      }),
      this.prisma.prediction.findMany({
        where: { fallback: false, shadow: false },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { features: true },
      }),
      this.prisma.prediction.findMany({
        where: {
          fallback: false,
          shadow: false,
          actualLabel: { not: null },
        },
        orderBy: { resolvedAt: 'desc' },
        take: 60,
        select: {
          probabilities: true,
          actualLabel: true,
        },
      }),
    ]);

    const shadowVersions = models
      .filter((m) => !m.isActive && m.status === 'shadow')
      .map((m) => m.version);
    const shadowRows =
      shadowVersions.length === 0
        ? []
        : await this.prisma.shadowEvaluation.findMany({
            where: { modelVersion: { in: shadowVersions } },
            orderBy: { generatedAt: 'desc' },
            take: 200,
            select: {
              modelVersion: true,
              status: true,
              realizedReturn: true,
              generatedAt: true,
            },
          });

    const drift = computeDrift(extractFeatureRows(recentForDrift));
    const calibration = computeBrier(labeledPredictions);
    const hits = resolved.filter((s) => s.status === 'hit_target').length;
    const stops = resolved.filter((s) => s.status === 'hit_stop').length;

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

    const body = {
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

    this.listCache = { at: Date.now(), body };
    return body;
  }

  @Post('generate-signals')
  generate() {
    this.listCache = null;
    return this.ml.runManualGenerateSignals();
  }

  /** Queue curated 5-slot portfolio retrain (async). */
  @Post('portfolio/retrain')
  portfolioRetrain() {
    this.listCache = null;
    return this.ml.enqueuePortfolioTrain();
  }

  /** Queue shadow retrains for top liquid symbols (async). */
  @Post('retrain')
  retrain(@Query('limit') limitRaw?: string) {
    this.listCache = null;
    const n = Math.min(20, Math.max(1, Number(limitRaw) || 10));
    return this.ml.enqueueRetrain(n);
  }

  @Post('resolve-signals')
  resolve() {
    this.listCache = null;
    return this.ml.enqueueResolveSignals();
  }

  @Post(':version/promote')
  promote(@Param('version') version: string) {
    this.listCache = null;
    return this.ml.promoteModel(version);
  }

  /** Manually run the champion–challenger lifecycle pass. */
  @Post('lifecycle/run')
  runLifecycle() {
    this.listCache = null;
    return this.lifecycle.runLifecycle();
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../common/bullmq-redis';
import { AlertsService } from '../common/alerts.service';
import { UNIVERSE } from '../market-data/universe';
import { PrismaService } from '../prisma/prisma.service';
import { MlBridgeService } from '../signals/ml-bridge.service';
import { computeDrift, extractFeatureRows } from './drift';

export const MODEL_LIFECYCLE_QUEUE = 'model-lifecycle';

export interface LifecycleReport {
  promotions: Array<{ version: string; regime: string; reason: string }>;
  rollbacks: Array<{ version: string; regime: string; reason: string }>;
  /** Challengers that beat the champion offline but are held by soak gates. */
  holds: Array<{ version: string; regime: string; reason: string }>;
  retrains: string[];
  drift: { score: number | null; level: string };
}

interface SoakGateResult {
  passed: boolean;
  reasons: string[];
  shadowSamples: number;
  shadowHitRate: number | null;
  championHitRate: number | null;
  soakAgeHours: number;
}

/**
 * Automated champion–challenger model management.
 *
 * Daily pass:
 * 1. Rollback: an active champion whose live signal outcomes are poor
 *    (hit rate below threshold on enough samples) is demoted back to shadow.
 * 2. Promotion: the best shadow challenger per regime that beats the current
 *    champion on offline metrics must additionally pass live soak gates —
 *    minimum shadow age, minimum resolved hidden shadow-evaluation samples,
 *    and live shadow performance at least matching the champion — before it
 *    is promoted through the ML service's quality gates (which can still
 *    reject it — that is expected and logged).
 * 3. Drift: if feature drift reaches alert level, shadow-retrain top symbols
 *    so fresh challengers exist for the next pass.
 */
@Injectable()
export class ModelLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelLifecycleService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ml: MlBridgeService,
    private readonly alerts: AlertsService,
  ) {}

  private get minLiveSamples(): number {
    return Number(this.config.get('MODEL_ROLLBACK_MIN_SAMPLES', '20'));
  }

  private get rollbackHitRate(): number {
    return Number(this.config.get('MODEL_ROLLBACK_HIT_RATE', '0.45'));
  }

  /** Only score live outcomes inside this window for rollback decisions. */
  private get rollbackLookbackHours(): number {
    const configured = Number(
      this.config.get('MODEL_ROLLBACK_LOOKBACK_HOURS', '168'),
    );
    return Math.max(24, Number.isFinite(configured) ? configured : 168);
  }

  /**
   * Minimum shadow soak age before a challenger may be promoted. Clamped to
   * at least 24h so a weekly retrain can never be promoted the same day it
   * was trained, regardless of misconfiguration.
   */
  private get minSoakHours(): number {
    const configured = Number(this.config.get('MODEL_MIN_SOAK_HOURS', '72'));
    return Math.max(24, Number.isFinite(configured) ? configured : 72);
  }

  /** Minimum resolved (decisive) live shadow samples before promotion. */
  private get minShadowSamples(): number {
    const configured = Number(
      this.config.get('MODEL_MIN_SHADOW_SAMPLES', '20'),
    );
    return Math.max(1, Number.isFinite(configured) ? configured : 20);
  }

  /** Effective promotion-gate thresholds, for the models API/UI. */
  promotionGateConfig(): { minSoakHours: number; minShadowSamples: number } {
    return {
      minSoakHours: this.minSoakHours,
      minShadowSamples: this.minShadowSamples,
    };
  }

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') return;
    const connection = bullmqConnection(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    this.queue = new Queue(MODEL_LIFECYCLE_QUEUE, { connection });
    this.worker = new Worker(
      MODEL_LIFECYCLE_QUEUE,
      async () => {
        await this.runLifecycle();
      },
      { connection },
    );
    this.worker.on('failed', (_job, err) =>
      this.logger.warn(`model-lifecycle failed: ${err.message}`),
    );
    await this.queue
      .add(
        'daily-model-lifecycle',
        {},
        // After nightly selection (22:00) so fresh training results exist.
        { repeat: { pattern: '30 22 * * 1-5' }, removeOnComplete: 30, removeOnFail: 30 },
      )
      .catch((err) =>
        this.logger.warn(`Could not schedule model lifecycle: ${err.message}`),
      );
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /** Full lifecycle pass. Also exposed via POST /models/lifecycle/run. */
  async runLifecycle(): Promise<LifecycleReport> {
    const report: LifecycleReport = {
      promotions: [],
      rollbacks: [],
      holds: [],
      retrains: [],
      drift: { score: null, level: 'insufficient_data' },
    };

    await this.rollbackUnderperformingChampions(report);
    await this.promoteBestChallengers(report);
    await this.retrainOnDrift(report);
    this.logger.log(
      `Model lifecycle: ${report.promotions.length} promoted, ` +
        `${report.rollbacks.length} rolled back, ${report.holds.length} held by soak gates, ` +
        `${report.retrains.length} retrained, drift=${report.drift.level}`,
    );
    return report;
  }

  private async rollbackUnderperformingChampions(report: LifecycleReport) {
    const champions = await this.prisma.modelRegistry.findMany({
      where: { isActive: true },
    });
    // Only score recent live outcomes so a pre-fix stop streak cannot
    // immediately vacuum the book again after we restore a champion.
    const recentSince = new Date(
      Date.now() - this.rollbackLookbackHours * 60 * 60 * 1000,
    );
    for (const champion of champions) {
      const outcomes = await this.prisma.signal.findMany({
        where: {
          modelVersion: champion.version,
          status: { in: ['hit_target', 'hit_stop'] },
          resolvedAt: { gte: recentSince },
        },
        orderBy: { resolvedAt: 'desc' },
        take: 50,
        select: { status: true },
      });
      if (outcomes.length < this.minLiveSamples) continue;
      const wins = outcomes.filter((s) => s.status === 'hit_target').length;
      const hitRate = wins / outcomes.length;
      if (hitRate >= this.rollbackHitRate) continue;

      const reason =
        `live hit rate ${(hitRate * 100).toFixed(1)}% over ${outcomes.length} ` +
        `signals (last ${this.rollbackLookbackHours}h) is below rollback threshold ` +
        `${(this.rollbackHitRate * 100).toFixed(0)}%`;

      // Never demote into a vacuum: require a soak-ready successor first.
      const successor = await this.findPromotableSuccessor(champion, report);
      if (!successor) {
        report.holds.push({
          version: champion.version,
          regime: champion.regime,
          reason: `rollback deferred (no ready successor): ${reason}`,
        });
        this.logger.warn(
          `Kept underperforming champion ${champion.version}: no soak-ready successor`,
        );
        continue;
      }

      try {
        await this.ml.promoteModel(successor.version);
        report.promotions.push({
          version: successor.version,
          regime: successor.regime,
          reason: `successor replaces underperforming ${champion.version}; ${reason}`,
        });
      } catch (err) {
        report.holds.push({
          version: champion.version,
          regime: champion.regime,
          reason: `rollback aborted (successor promote failed: ${(err as Error).message})`,
        });
        continue;
      }

      await this.prisma.modelRegistry.update({
        where: { version: champion.version },
        data: {
          isActive: false,
          status: 'shadow',
          promotionReason: `auto-rollback: ${reason}`,
          shadowStartedAt: new Date(),
        },
      });
      report.rollbacks.push({
        version: champion.version,
        regime: champion.regime,
        reason,
      });
      await this.alerts.send('model.rollback', 'warning', {
        version: champion.version,
        regime: champion.regime,
        reason,
        successor: successor.version,
      });
    }
  }

  /**
   * Best shadow challenger that already clears soak gates for this champion's
   * regime / strategy slot. Used to avoid demoting into an empty book.
   */
  private async findPromotableSuccessor(
    champion: {
      version: string;
      regime: string;
      strategyId: string | null;
      expectancy: number;
      precision: number;
    },
    report: LifecycleReport,
  ) {
    const challengers = await this.prisma.modelRegistry.findMany({
      where: {
        isActive: false,
        status: 'shadow',
        version: { not: champion.version },
        ...(champion.strategyId
          ? { strategyId: champion.strategyId }
          : { regime: champion.regime }),
      },
      orderBy: { expectancy: 'desc' },
      take: 20,
    });
    for (const best of challengers) {
      if (report.rollbacks.some((r) => r.version === best.version)) continue;
      const beatsChampion =
        best.expectancy > champion.expectancy &&
        best.precision >= champion.precision * 0.95;
      if (!beatsChampion) continue;
      const soak = await this.evaluateSoakGates(best, champion);
      if (!soak.passed) continue;
      return best;
    }
    return null;
  }

  private async promoteBestChallengers(report: LifecycleReport) {
    const models = await this.prisma.modelRegistry.findMany({
      orderBy: { trainedAt: 'desc' },
      take: 100,
    });
    const regimes = [...new Set(models.map((m) => m.regime))];
    for (const regime of regimes) {
      const champion = models.find((m) => m.regime === regime && m.isActive);
      const challengers = models
        .filter(
          (m) =>
            m.regime === regime &&
            !m.isActive &&
            m.status === 'shadow' &&
            // Never re-promote the version we just rolled back in this pass.
            !report.rollbacks.some((r) => r.version === m.version),
        )
        .sort((a, b) => b.expectancy - a.expectancy);
      const best = challengers[0];
      if (!best) continue;

      // Offline quality comparison is preserved as the first gate.
      const beatsChampion =
        !champion ||
        (best.expectancy > champion.expectancy &&
          best.precision >= champion.precision * 0.95);
      if (!beatsChampion) continue;

      // Live soak gates: minimum shadow age, minimum resolved hidden shadow
      // samples, and shadow performance at least matching the champion.
      const soak = await this.evaluateSoakGates(best, champion ?? null);
      if (!soak.passed) {
        const reason = soak.reasons.join('; ');
        report.holds.push({ version: best.version, regime, reason });
        this.logger.log(
          `Challenger ${best.version} held by soak gates: ${reason}`,
        );
        continue;
      }

      try {
        await this.ml.promoteModel(best.version);
        const liveNote =
          `live shadow hit rate ${soak.shadowHitRate == null ? 'n/a' : (soak.shadowHitRate * 100).toFixed(1) + '%'} ` +
          `over ${soak.shadowSamples} hidden samples after ${soak.soakAgeHours.toFixed(0)}h soak`;
        const reason = champion
          ? `challenger beats champion ${champion.version} on expectancy ` +
            `(${best.expectancy.toFixed(4)} > ${champion.expectancy.toFixed(4)}); ${liveNote}`
          : `no active champion for regime; ${liveNote}`;
        report.promotions.push({ version: best.version, regime, reason });
        await this.alerts.send('model.promoted', 'info', {
          version: best.version,
          regime,
          reason,
        });
      } catch (err) {
        // Quality/artifact gates rejecting a candidate is a normal outcome.
        this.logger.log(
          `Challenger ${best.version} not promoted: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Live shadow-soak promotion gates. All shadow statistics come from hidden
   * ShadowEvaluation rows recorded during the current soak window, so a
   * rolled-back model cannot re-qualify on stale history.
   */
  private async evaluateSoakGates(
    challenger: {
      version: string;
      trainedAt: Date;
      shadowStartedAt?: Date | null;
    },
    champion: { version: string } | null,
  ): Promise<SoakGateResult> {
    const reasons: string[] = [];
    const soakStart = challenger.shadowStartedAt ?? challenger.trainedAt;
    const soakAgeHours = (Date.now() - soakStart.getTime()) / 3_600_000;
    if (soakAgeHours < this.minSoakHours) {
      reasons.push(
        `soak age ${soakAgeHours.toFixed(1)}h is below the required ` +
          `${this.minSoakHours}h (same-day promotion is never allowed)`,
      );
    }

    const shadowOutcomes = await this.prisma.shadowEvaluation.findMany({
      where: {
        modelVersion: challenger.version,
        status: { in: ['hit_target', 'hit_stop'] },
        generatedAt: { gte: soakStart },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 100,
      select: { status: true },
    });
    const shadowWins = shadowOutcomes.filter(
      (row) => row.status === 'hit_target',
    ).length;
    const shadowHitRate =
      shadowOutcomes.length > 0 ? shadowWins / shadowOutcomes.length : null;
    if (shadowOutcomes.length < this.minShadowSamples) {
      reasons.push(
        `only ${shadowOutcomes.length} resolved live shadow samples; ` +
          `${this.minShadowSamples} required`,
      );
    }

    let championHitRate: number | null = null;
    if (champion) {
      const championOutcomes = await this.prisma.signal.findMany({
        where: {
          modelVersion: champion.version,
          status: { in: ['hit_target', 'hit_stop'] },
        },
        orderBy: { resolvedAt: 'desc' },
        take: 100,
        select: { status: true },
      });
      if (championOutcomes.length >= this.minLiveSamples) {
        const championWins = championOutcomes.filter(
          (row) => row.status === 'hit_target',
        ).length;
        championHitRate = championWins / championOutcomes.length;
      }
    }
    // Compare against the champion's live record when it has one; otherwise
    // the challenger must at least clear the rollback floor so a model that
    // would be immediately demoted can never be promoted.
    const requiredHitRate = championHitRate ?? this.rollbackHitRate;
    if (
      shadowOutcomes.length >= this.minShadowSamples &&
      (shadowHitRate ?? 0) < requiredHitRate
    ) {
      reasons.push(
        `live shadow hit rate ${((shadowHitRate ?? 0) * 100).toFixed(1)}% is below ` +
          (championHitRate != null
            ? `champion live hit rate ${(championHitRate * 100).toFixed(1)}%`
            : `rollback floor ${(this.rollbackHitRate * 100).toFixed(0)}%`),
      );
    }

    return {
      passed: reasons.length === 0,
      reasons,
      shadowSamples: shadowOutcomes.length,
      shadowHitRate,
      championHitRate,
      soakAgeHours,
    };
  }

  private async retrainOnDrift(report: LifecycleReport) {
    // Shadow (challenger) inferences are excluded: drift is a property of the
    // production feature stream, not of how many challengers are soaking.
    const predictions = await this.prisma.prediction.findMany({
      where: { fallback: false, shadow: false },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { features: true },
    });
    const drift = computeDrift(extractFeatureRows(predictions));
    report.drift = { score: drift.score, level: drift.level };
    if (drift.level !== 'alert') return;

    await this.alerts.send('model.drift_alert', 'warning', {
      score: drift.score,
      sampleSize: drift.sampleSize,
    });
    // Drift retrains stay on the 3 most liquid symbols to bound ML load.
    for (const symbol of UNIVERSE.slice(0, 3)) {
      try {
        const bars = await this.ml.loadBars(symbol, 500);
        if (bars.length < 120) continue;
        await this.ml.train(symbol, bars, true);
        report.retrains.push(symbol);
        this.logger.log(`Drift-triggered shadow retrain completed for ${symbol}`);
      } catch (err) {
        this.logger.warn(
          `Drift retrain failed for ${symbol}: ${(err as Error).message}`,
        );
      }
    }
  }
}

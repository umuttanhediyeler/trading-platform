import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { signalsCreatedTotal } from '../metrics/counters';
import { PrismaService } from '../prisma/prisma.service';
import { SIGNAL_UNIVERSE_SIZE, UNIVERSE } from '../market-data/universe';

/**
 * Signal generation and retraining stay on the most liquid top-N slice of the
 * full ~100-symbol universe to bound per-cycle latency and ML-service load.
 */
const SIGNAL_UNIVERSE = UNIVERSE.slice(0, SIGNAL_UNIVERSE_SIZE);
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from '../market-data/providers/market-data-provider.interface';
import { SignalsGateway } from './signals.gateway';
import { SimulationService } from '../simulation/simulation.service';

export const NIGHTLY_QUEUE = 'ml-nightly';
export const SIGNAL_QUEUE = 'ml-signal-generation';
export const RETRAIN_QUEUE = 'ml-retrain';

export interface MlBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PredictionResponse {
  symbol: string;
  prediction: 'tp' | 'sl' | 'timeout';
  confidence: number;
  probabilities: Record<string, number>;
  regime: string;
  model_version: string | null;
  fallback: boolean;
  features: Record<string, number>;
  feature_timestamp: string;
}

const STRATEGY_RISK: Record<
  string,
  { stopLossPercent: number; takeProfitPercent: number }
> = {
  tb_tight_scalp: { stopLossPercent: 0.005, takeProfitPercent: 0.01 },
  tb_balanced: { stopLossPercent: 0.01, takeProfitPercent: 0.02 },
  tb_wide_swing: { stopLossPercent: 0.02, takeProfitPercent: 0.04 },
  tb_momentum: { stopLossPercent: 0.01, takeProfitPercent: 0.03 },
  tb_mean_revert: { stopLossPercent: 0.015, takeProfitPercent: 0.015 },
};

/**
 * HTTP bridge to the Python ML service. Owns nightly selection, weekly
 * retrain, and intraday signal-generation cron jobs.
 */
@Injectable()
export class MlBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MlBridgeService.name);
  private queues: Queue[] = [];
  private workers: Worker[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: SignalsGateway,
    private readonly simulation: SimulationService,
    @Inject(MARKET_DATA_PROVIDER)
    private readonly marketData: MarketDataProvider,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('ML_SERVICE_URL', 'http://localhost:8001');
  }

  /**
   * Run inference. When modelVersion is provided the ML service scores with
   * that registered artifact (shadow/challenger path) instead of the active
   * production model.
   */
  async predict(
    symbol: string,
    bars: MlBar[],
    modelVersion?: string,
  ): Promise<PredictionResponse> {
    const res = await fetch(`${this.baseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        modelVersion ? { symbol, bars, model_version: modelVersion } : { symbol, bars },
      ),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `ML service /predict failed: ${res.status}`,
      );
    }
    return res.json();
  }

  async train(symbol: string, bars: MlBar[], shadow = true) {
    const res = await fetch(`${this.baseUrl}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        bars,
        save_to_registry: true,
        shadow,
      }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `ML service /train failed: ${res.status}`,
      );
    }
    return res.json();
  }

  async triggerNightly(bars: MlBar[]): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/nightly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'UNIVERSE', bars }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `ML service /nightly failed: ${res.status}`,
      );
    }
    this.logger.log('Nightly strategy selection completed');
    return res.json();
  }

  async listModels(limit = 50) {
    const res = await fetch(`${this.baseUrl}/models?limit=${limit}`);
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `ML service /models failed: ${res.status}`,
      );
    }
    return res.json();
  }

  async promoteModel(version: string) {
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(version)}/promote`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { detail?: string | { message?: string; gateFailures?: string[] } }
        | null;
      const detail = body?.detail;
      if (res.status === 409) {
        throw new ConflictException(
          typeof detail === 'object' && detail
            ? detail
            : { message: 'Model failed promotion gates' },
        );
      }
      if (res.status === 404) {
        throw new NotFoundException(
          typeof detail === 'string' ? detail : 'Model version not found',
        );
      }
      throw new ServiceUnavailableException(
        `ML service promote failed: ${res.status}`,
      );
    }
    return res.json();
  }

  /** Load recent daily bars for a symbol from the Timescale hypertable. */
  async loadBars(symbol: string, limit = 400): Promise<MlBar[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        timestamp: Date;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>
    >`
      SELECT timestamp, open, high, low, close, volume
      FROM bars
      WHERE symbol = ${symbol}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
    const stored = rows
      .reverse()
      .map((r) => ({
        timestamp: new Date(r.timestamp).toISOString(),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
    if (stored.length >= Math.min(limit, 120)) return stored;

    // A fresh installation may not have accumulated enough Timescale bars yet.
    // Backfill from the configured market-data provider so training/signals are
    // usable immediately, while normal operation still prefers local storage.
    try {
      const to = new Date(Date.now() - 16 * 60_000);
      const from = new Date(
        to.getTime() - Math.max(limit * 2, 180) * 24 * 60 * 60 * 1000,
      );
      const fetched = await this.marketData.getHistoricalBars(
        symbol,
        '1d',
        from,
        to,
      );
      if (fetched.length > stored.length) {
        return fetched.slice(-limit).map((bar) => ({
          timestamp: bar.timestamp.toISOString(),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }));
      }
    } catch (error) {
      this.logger.warn(
        `Market-data backfill failed for ${symbol}: ${(error as Error).message}`,
      );
    }
    return stored;
  }

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') {
      return;
    }
    const connection = this.connectionOptions();

    await this.schedule(
      NIGHTLY_QUEUE,
      'nightly-strategy-selection',
      '0 22 * * 1-5',
      async () => {
        const bars = await this.loadBars('AAPL', 500);
        if (bars.length < 80) {
          this.logger.warn('Nightly skipped: insufficient bars in DB');
          return;
        }
        await this.triggerNightly(bars);
      },
      connection,
    );

    await this.schedule(
      RETRAIN_QUEUE,
      'weekly-retrain',
      '0 23 * * 0',
      async () => {
        for (const symbol of SIGNAL_UNIVERSE.slice(0, 5)) {
          const bars = await this.loadBars(symbol, 500);
          if (bars.length < 120) continue;
          await this.train(symbol, bars, true);
          this.logger.log(`Shadow retrain completed for ${symbol}`);
        }
      },
      connection,
    );

    await this.schedule(
      SIGNAL_QUEUE,
      'intraday-signals',
      '*/5 * * * 1-5',
      async () => {
        await this.resolveOpenSignals();
        await this.resolveShadowEvaluations();
        await this.generateSignals();
      },
      connection,
    );
  }

  /**
   * Walk bars after generation and classify the barrier outcome. OHLC data
   * does not reveal intrabar ordering; if both barriers are touched in one
   * candle the conservative stop-first outcome is used.
   */
  private classifyOutcome(
    generatedAt: Date,
    entry: number,
    stop: number,
    target: number,
    bars: MlBar[],
    cutoffMs: number,
  ): { status: 'hit_target' | 'hit_stop' | 'expired'; resolvedPrice: number } | null {
    const after = bars.filter(
      (bar) => new Date(bar.timestamp).getTime() >= generatedAt.getTime(),
    );
    const path = after.length > 0 ? after : bars.slice(-5);
    if (generatedAt.getTime() < cutoffMs) {
      return { status: 'expired', resolvedPrice: path.at(-1)?.close ?? entry };
    }
    for (const bar of path) {
      if (bar.low <= stop) return { status: 'hit_stop', resolvedPrice: stop };
      if (bar.high >= target)
        return { status: 'hit_target', resolvedPrice: target };
    }
    return null;
  }

  /** Mark open signals hit_target / hit_stop / expired from latest bars. */
  async resolveOpenSignals(maxAgeHours = 48) {
    const open = await this.prisma.signal.findMany({
      where: { status: 'open' },
      take: 100,
    });
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const affectedModels = new Set<string>();
    let resolvedCount = 0;

    for (const signal of open) {
      try {
        const bars = await this.loadBars(signal.symbol, 40);
        if (bars.length === 0 && signal.generatedAt.getTime() >= cutoff) continue;
        const outcome = this.classifyOutcome(
          signal.generatedAt,
          Number(signal.entryPrice),
          Number(signal.stopPrice),
          Number(signal.targetPrice),
          bars,
          cutoff,
        );
        if (!outcome) continue;
        const { status, resolvedPrice } = outcome;

        const resolvedAt = new Date();
        const realizedReturn =
          (resolvedPrice - Number(signal.entryPrice)) /
          Number(signal.entryPrice);
        const updated = await this.prisma.$transaction(async (tx) => {
          const row = await tx.signal.update({
            where: { id: signal.id },
            data: {
              status,
              resolvedAt,
              resolvedPrice,
              realizedReturn,
            },
          });
          if (signal.predictionId) {
            await tx.prediction.update({
              where: { id: signal.predictionId },
              data: {
                actualLabel:
                  status === 'hit_target'
                    ? 'tp'
                    : status === 'hit_stop'
                      ? 'sl'
                      : 'timeout',
                resolvedAt,
              },
            });
          }
          return row;
        });
        resolvedCount += 1;
        if (signal.modelVersion) affectedModels.add(signal.modelVersion);
        this.gateway.emitSignalResolved({
          id: updated.id,
          symbol: updated.symbol,
          status: updated.status,
          resolvedAt: updated.resolvedAt?.toISOString(),
          resolvedPrice: Number(updated.resolvedPrice),
          realizedReturn: updated.realizedReturn,
        });
      } catch (err) {
        this.logger.warn(
          `Signal resolve failed ${signal.id}: ${(err as Error).message}`,
        );
      }
    }

    for (const version of affectedModels) {
      await this.snapshotModelPerformance(version).catch((err: Error) =>
        this.logger.warn(`Performance snapshot failed ${version}: ${err.message}`),
      );
    }
    return { resolved: resolvedCount };
  }

  /**
   * Resolve open shadow (challenger) evaluations with the same barrier logic
   * as production signals. Deliberately silent: no WebSocket emission, no
   * simulated orders, no user-facing side effects — outcomes only feed the
   * promotion soak gates.
   */
  async resolveShadowEvaluations(maxAgeHours = 48) {
    const open = await this.prisma.shadowEvaluation.findMany({
      where: { status: 'open' },
      take: 200,
    });
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let resolvedCount = 0;
    const barsCache = new Map<string, MlBar[]>();

    for (const evaluation of open) {
      try {
        let bars = barsCache.get(evaluation.symbol);
        if (!bars) {
          bars = await this.loadBars(evaluation.symbol, 40);
          barsCache.set(evaluation.symbol, bars);
        }
        if (bars.length === 0 && evaluation.generatedAt.getTime() >= cutoff) {
          continue;
        }
        const outcome = this.classifyOutcome(
          evaluation.generatedAt,
          Number(evaluation.entryPrice),
          Number(evaluation.stopPrice),
          Number(evaluation.targetPrice),
          bars,
          cutoff,
        );
        if (!outcome) continue;

        const resolvedAt = new Date();
        const realizedReturn =
          (outcome.resolvedPrice - Number(evaluation.entryPrice)) /
          Number(evaluation.entryPrice);
        await this.prisma.$transaction(async (tx) => {
          await tx.shadowEvaluation.update({
            where: { id: evaluation.id },
            data: {
              status: outcome.status,
              resolvedAt,
              resolvedPrice: outcome.resolvedPrice,
              realizedReturn,
            },
          });
          if (evaluation.predictionId) {
            await tx.prediction.update({
              where: { id: evaluation.predictionId },
              data: {
                actualLabel:
                  outcome.status === 'hit_target'
                    ? 'tp'
                    : outcome.status === 'hit_stop'
                      ? 'sl'
                      : 'timeout',
                resolvedAt,
              },
            });
          }
        });
        resolvedCount += 1;
      } catch (err) {
        this.logger.warn(
          `Shadow evaluation resolve failed ${evaluation.id}: ${(err as Error).message}`,
        );
      }
    }
    return { resolved: resolvedCount };
  }

  private async snapshotModelPerformance(modelVersion: string) {
    const model = await this.prisma.modelRegistry.findUnique({
      where: { version: modelVersion },
      select: { version: true },
    });
    if (!model) return;
    const outcomes = await this.prisma.signal.findMany({
      where: {
        modelVersion,
        status: { in: ['hit_target', 'hit_stop', 'expired'] },
      },
      select: { status: true, realizedReturn: true },
    });
    const wins = outcomes.filter((signal) => signal.status === 'hit_target').length;
    const losses = outcomes.filter((signal) => signal.status === 'hit_stop').length;
    const expired = outcomes.filter((signal) => signal.status === 'expired').length;
    const returns = outcomes
      .map((signal) => signal.realizedReturn)
      .filter((value): value is number => value !== null);
    await this.prisma.modelPerformanceSnapshot.create({
      data: {
        modelVersion,
        sampleSize: outcomes.length,
        wins,
        losses,
        expired,
        hitRate: wins + losses > 0 ? wins / (wins + losses) : null,
        averageReturn:
          returns.length > 0
            ? returns.reduce((sum, value) => sum + value, 0) / returns.length
            : null,
      },
    });
  }

  private get maxShadowCandidatesPerRegime(): number {
    const raw = this.config.get<string>('MODEL_SHADOW_MAX_CANDIDATES', '2') ?? '2';
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 2;
  }

  /**
   * Newest shadow candidates grouped by regime. Bounded per regime so shadow
   * scoring cannot multiply ML-service load unboundedly as retrains stack up.
   */
  private async loadShadowCandidates(): Promise<
    Map<string, Array<{ version: string; regime: string }>>
  > {
    const grouped = new Map<string, Array<{ version: string; regime: string }>>();
    const limit = this.maxShadowCandidatesPerRegime;
    if (limit === 0) return grouped;
    try {
      const rows = await this.prisma.modelRegistry.findMany({
        where: { status: 'shadow', isActive: false },
        orderBy: { trainedAt: 'desc' },
        take: 25,
        select: { version: true, regime: true },
      });
      for (const row of rows) {
        const list = grouped.get(row.regime) ?? [];
        if (list.length < limit) {
          list.push(row);
          grouped.set(row.regime, list);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Shadow candidate lookup failed: ${(err as Error).message}`,
      );
    }
    return grouped;
  }

  /**
   * Score shadow candidates on the same bars as the production model and
   * persist hidden evaluations. Nothing here is user-visible: no WebSocket
   * emission, no simulated orders, no Signal rows.
   */
  private async evaluateShadowCandidates(params: {
    symbol: string;
    bars: MlBar[];
    candidates: Array<{ version: string; regime: string }>;
    risk: { stopLossPercent: number; takeProfitPercent: number };
    minConfidence: number;
    productionVersion: string | null;
  }): Promise<{ predictions: number; evaluations: number }> {
    let predictions = 0;
    let evaluations = 0;
    for (const candidate of params.candidates) {
      if (candidate.version === params.productionVersion) continue;
      try {
        const prediction = await this.predict(
          params.symbol,
          params.bars,
          candidate.version,
        );
        // The ML service must confirm it scored the requested challenger;
        // anything else (fallback, version drift) is not a valid shadow sample.
        if (prediction.fallback || prediction.model_version !== candidate.version) {
          continue;
        }
        const stored = await this.prisma.prediction.create({
          data: {
            symbol: params.symbol,
            modelVersion: prediction.model_version,
            predictedLabel: prediction.prediction,
            confidence: prediction.confidence,
            probabilities: prediction.probabilities,
            regime: prediction.regime,
            fallback: prediction.fallback,
            shadow: true,
            features: prediction.features as Prisma.InputJsonValue,
            featureTimestamp: new Date(prediction.feature_timestamp),
            dataCutoff: new Date(
              params.bars[params.bars.length - 1].timestamp,
            ),
          },
        });
        predictions += 1;
        // Mirror the production entry gates so shadow outcomes measure the
        // exact decisions the challenger would have shipped as signals.
        if (
          prediction.prediction !== 'tp' ||
          prediction.confidence < params.minConfidence ||
          prediction.regime !== candidate.regime
        ) {
          continue;
        }
        const existing = await this.prisma.shadowEvaluation.findFirst({
          where: {
            modelVersion: candidate.version,
            symbol: params.symbol,
            status: 'open',
            generatedAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) },
          },
        });
        if (existing) continue;

        const last = params.bars[params.bars.length - 1];
        const entry = last.close;
        await this.prisma.shadowEvaluation.create({
          data: {
            modelVersion: candidate.version,
            symbol: params.symbol,
            entryPrice: entry,
            stopPrice: entry * (1 - params.risk.stopLossPercent),
            targetPrice: entry * (1 + params.risk.takeProfitPercent),
            confidence: prediction.confidence,
            status: 'open',
            predictionId: stored.id,
          },
        });
        evaluations += 1;
      } catch (err) {
        // A broken challenger must never disturb production signal flow.
        this.logger.warn(
          `Shadow evaluation failed for ${candidate.version} on ${params.symbol}: ${(err as Error).message}`,
        );
      }
    }
    return { predictions, evaluations };
  }

  /**
   * Persist every inference. Signals require a production-active model for the
   * detected regime plus a take-profit prediction over the confidence gate.
   * Shadow candidates are scored in parallel on the same bars, hidden from
   * users, so promotion gates can compare live challenger vs champion.
   */
  async generateSignals(minConfidence = 0.58) {
    const selections = await this.prisma.dailyStrategySelection.findMany({
      orderBy: [{ date: 'desc' }, { rank: 'asc' }],
      take: 5,
    });
    const strategyId = selections[0]?.strategyId ?? 'tb_balanced';
    const risk = STRATEGY_RISK[strategyId] ?? STRATEGY_RISK.tb_balanced;
    const shadowCandidatesByRegime = await this.loadShadowCandidates();
    let predictions = 0;
    let signalsCreated = 0;
    let shadowPredictions = 0;
    let shadowEvaluations = 0;

    for (const symbol of SIGNAL_UNIVERSE) {
      try {
        const bars = await this.loadBars(symbol, 120);
        if (bars.length < 60) continue;
        const prediction = await this.predict(symbol, bars);
        const storedPrediction = await this.prisma.prediction.create({
          data: {
            symbol,
            modelVersion: prediction.model_version,
            predictedLabel: prediction.prediction,
            confidence: prediction.confidence,
            probabilities: prediction.probabilities,
            regime: prediction.regime,
            fallback: prediction.fallback,
            features: prediction.features as Prisma.InputJsonValue,
            featureTimestamp: new Date(prediction.feature_timestamp),
            dataCutoff: new Date(bars[bars.length - 1].timestamp),
          },
        });
        predictions += 1;

        // Shadow scoring runs before the production gates on purpose: it must
        // happen even when there is no active champion (bootstrap) or the
        // champion declines the trade.
        const candidates =
          shadowCandidatesByRegime.get(prediction.regime) ?? [];
        if (candidates.length > 0) {
          const shadowResult = await this.evaluateShadowCandidates({
            symbol,
            bars,
            candidates,
            risk,
            minConfidence,
            productionVersion: prediction.model_version,
          });
          shadowPredictions += shadowResult.predictions;
          shadowEvaluations += shadowResult.evaluations;
        }

        if (
          prediction.fallback ||
          !prediction.model_version ||
          prediction.prediction !== 'tp' ||
          prediction.confidence < minConfidence
        ) {
          continue;
        }
        const activeModel = await this.prisma.modelRegistry.findUnique({
          where: { version: prediction.model_version },
          select: { isActive: true, status: true, regime: true },
        });
        if (
          !activeModel?.isActive ||
          activeModel.status !== 'active' ||
          activeModel.regime !== prediction.regime
        ) {
          this.logger.warn(
            `Prediction ignored: ${prediction.model_version} is not active for ${prediction.regime}`,
          );
          continue;
        }

        const last = bars[bars.length - 1];
        const entry = last.close;
        const stop = entry * (1 - risk.stopLossPercent);
        const target = entry * (1 + risk.takeProfitPercent);
        const existing = await this.prisma.signal.findFirst({
          where: {
            symbol,
            status: 'open',
            generatedAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) },
          },
        });
        if (existing) continue;

        const signal = await this.prisma.signal.create({
          data: {
            symbol,
            strategyId,
            entryPrice: entry,
            stopPrice: stop,
            targetPrice: target,
            confidence: prediction.confidence,
            status: 'open',
            modelVersion: prediction.model_version,
            predictionId: storedPrediction.id,
          },
        });
        signalsCreated += 1;
        signalsCreatedTotal.inc();
        this.gateway.emitNewSignal({
          id: signal.id,
          symbol: signal.symbol,
          strategyId: signal.strategyId,
          entryPrice: Number(signal.entryPrice),
          stopPrice: Number(signal.stopPrice),
          targetPrice: Number(signal.targetPrice),
          confidence: signal.confidence,
          generatedAt: signal.generatedAt.toISOString(),
          status: signal.status,
          modelVersion: signal.modelVersion,
        });

        const premiumUsers = await this.prisma.user.findMany({
          where: {
            subscription: {
              planTier: 'premium',
              status: { in: ['active', 'trialing'] },
            },
          },
          select: { id: true },
          take: 100,
        });
        for (const user of premiumUsers) {
          await this.simulation
            .openOrder(user.id, {
              symbol,
              side: 'buy',
              quantity: 1,
              entryPrice: entry,
              stopPrice: stop,
              targetPrice: target,
              source: 'ai_signal',
            })
            .catch(() => undefined);
        }
        this.logger.log(
          `Signal created ${symbol} conf=${prediction.confidence.toFixed(2)}`,
        );
      } catch (err) {
        this.logger.warn(
          `Signal generation failed for ${symbol}: ${(err as Error).message}`,
        );
      }
    }
    return { predictions, signalsCreated, shadowPredictions, shadowEvaluations };
  }

  private async schedule(
    queueName: string,
    jobName: string,
    pattern: string,
    handler: () => Promise<void>,
    connection: ReturnType<MlBridgeService['connectionOptions']>,
  ) {
    const queue = new Queue(queueName, { connection });
    const worker = new Worker(queueName, async () => handler(), { connection });
    worker.on('failed', (_job, err) =>
      this.logger.warn(`${queueName} failed: ${err.message}`),
    );
    this.queues.push(queue);
    this.workers.push(worker);
    await queue
      .add(jobName, {}, { repeat: { pattern }, removeOnComplete: 30, removeOnFail: 30 })
      .catch((err) =>
        this.logger.warn(`Could not schedule ${jobName}: ${err.message}`),
      );
  }

  private connectionOptions() {
    const url = new URL(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
    };
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all(this.queues.map((q) => q.close().catch(() => undefined)));
  }
}

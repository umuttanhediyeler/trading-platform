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
import { bullmqConnection } from '../common/bullmq-redis';
import { signalsCreatedTotal } from '../metrics/counters';
import { PrismaService } from '../prisma/prisma.service';
import { UNIVERSE } from '../market-data/universe';
import { SignalUniverseService } from '../market-data/signal-universe.service';
import { computePositionSize } from '../execution/position-sizing';
import {
  computeRiskTargets,
  pickStrategyId,
  STRATEGY_RISK,
} from '../execution/risk-targets';
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

/**
 * HTTP bridge to the Python ML service. Owns nightly selection, weekly
 * retrain, and intraday signal-generation cron jobs.
 */
@Injectable()
export class MlBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MlBridgeService.name);
  private queues: Queue[] = [];
  private workers: Worker[] = [];
  /** Kept for one-shot manual generate from the Models UI (avoids Caddy 60s timeout). */
  private signalQueue?: Queue;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: SignalsGateway,
    private readonly simulation: SimulationService,
    private readonly signalUniverse: SignalUniverseService,
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

  /**
   * Load recent **daily** bars for training / inference features.
   * The `bars` hypertable mixes 1-minute ticks with daily rows; taking the
   * newest N rows yields ~2 weeks of minutes and collapses walk-forward
   * windows. Prefer the market-data provider's 1d series, then fall back to
   * day-boundary rows in Timescale.
   */
  async loadBars(symbol: string, limit = 400): Promise<MlBar[]> {
    const toMl = (
      bars: Array<{
        timestamp: Date | string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>,
    ): MlBar[] =>
      bars.map((bar) => ({
        timestamp:
          bar.timestamp instanceof Date
            ? bar.timestamp.toISOString()
            : new Date(bar.timestamp).toISOString(),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume),
      }));

    try {
      const to = new Date(Date.now() - 16 * 60_000);
      const from = new Date(
        to.getTime() - Math.max(limit + 40, 260) * 24 * 60 * 60 * 1000,
      );
      const fetched = await this.marketData.getHistoricalBars(
        symbol,
        '1d',
        from,
        to,
      );
      if (fetched.length >= Math.min(limit, 80)) {
        return toMl(fetched.slice(-limit));
      }
    } catch (error) {
      this.logger.warn(
        `Daily bar fetch failed for ${symbol}: ${(error as Error).message}`,
      );
    }

    // Day-boundary rows only — skips the 1-minute stream that crowds LIMIT.
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
        AND timestamp = date_trunc('day', timestamp)
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
    return toMl(rows.reverse());
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
        for (const symbol of UNIVERSE.slice(0, 10)) {
          const bars = await this.loadBars(symbol, 500);
          if (bars.length < 120) continue;
          await this.train(symbol, bars, true);
          this.logger.log(`Shadow retrain completed for ${symbol}`);
        }
      },
      connection,
    );

    this.signalQueue = await this.scheduleSignalQueue(connection);
  }

  private async scheduleSignalQueue(
    connection: ReturnType<MlBridgeService['connectionOptions']>,
  ): Promise<Queue> {
    const queue = new Queue(SIGNAL_QUEUE, { connection });
    const worker = new Worker(
      SIGNAL_QUEUE,
      async (job) => {
        if (job.name === 'manual-retrain') {
          const symbols =
            (job.data?.symbols as string[] | undefined) ??
            UNIVERSE.slice(0, 10);
          for (const symbol of symbols) {
            try {
              const bars = await this.loadBars(symbol, 500);
              if (bars.length < 120) {
                this.logger.warn(
                  `Retrain skipped ${symbol}: only ${bars.length} bars`,
                );
                continue;
              }
              const result = (await this.train(symbol, bars, true)) as {
                version?: string;
                windows?: Array<{ precision?: number }>;
              };
              const prec =
                result.windows && result.windows.length > 0
                  ? result.windows.reduce(
                      (s, w) => s + Number(w.precision ?? 0),
                      0,
                    ) / result.windows.length
                  : null;
              this.logger.log(
                `Retrain done ${symbol} version=${result.version ?? "?"} precision=${prec?.toFixed(3) ?? "?"}`,
              );
            } catch (err) {
              this.logger.warn(
                `Retrain failed ${symbol}: ${(err as Error).message}`,
              );
            }
          }
          return;
        }
        await this.resolveOpenSignals();
        await this.resolveShadowEvaluations();
        await this.generateSignals();
      },
      { connection, concurrency: 1, lockDuration: 300_000 },
    );
    worker.on('failed', (_job, err) =>
      this.logger.warn(`${SIGNAL_QUEUE} failed: ${err.message}`),
    );
    this.queues.push(queue);
    this.workers.push(worker);
    await queue
      .add(
        'intraday-signals',
        {},
        {
          repeat: { pattern: '*/5 * * * 1-5' },
          removeOnComplete: 30,
          removeOnFail: 30,
        },
      )
      .catch((err) =>
        this.logger.warn(`Could not schedule intraday-signals: ${err.message}`),
      );
    return queue;
  }

  /**
   * Queue shadow retrains for top liquid symbols so new challengers can clear
   * promotion gates. HTTP returns immediately — training takes minutes.
   */
  async enqueueRetrain(symbolCount = 10): Promise<{
    queued: true;
    jobId: string | undefined;
    symbols: string[];
  }> {
    const symbols = UNIVERSE.slice(0, Math.min(20, Math.max(1, symbolCount)));
    if (!this.signalQueue) {
      for (const symbol of symbols) {
        const bars = await this.loadBars(symbol, 500);
        if (bars.length < 120) continue;
        await this.train(symbol, bars, true);
      }
      return { queued: true, jobId: undefined, symbols };
    }
    const job = await this.signalQueue.add(
      'manual-retrain',
      { symbols },
      { removeOnComplete: 20, removeOnFail: 20 },
    );
    this.logger.log(
      `Manual retrain queued job=${job.id} symbols=${symbols.join(",")}`,
    );
    return { queued: true, jobId: job.id, symbols };
  }

  /**
   * Queue a full signal cycle instead of awaiting it on the HTTP request.
   * Manual "Sinyal üret" was timing out at the reverse proxy (~60s) while the
   * universe loop often needs several minutes.
   */
  async enqueueGenerateSignals(): Promise<{
    queued: true;
    jobId: string | undefined;
  }> {
    if (!this.signalQueue) {
      // Workers disabled (e.g. tests) — still run inline so the endpoint works.
      await this.resolveOpenSignals();
      await this.resolveShadowEvaluations();
      await this.generateSignals();
      return { queued: true, jobId: undefined };
    }
    const job = await this.signalQueue.add(
      'manual-generate',
      { source: 'manual' },
      { removeOnComplete: 30, removeOnFail: 30 },
    );
    this.logger.log(`Manual signal generation queued job=${job.id}`);
    return { queued: true, jobId: job.id };
  }

  /**
   * Walk bars after generation and classify the barrier outcome. OHLC data
   * does not reveal intrabar ordering; if both barriers are touched in one
   * candle the conservative stop-first outcome is used.
   *
   * Never evaluates bars before `generatedAt` — that produced false
   * hit_target/hit_stop results from older highs/lows.
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
    if (generatedAt.getTime() < cutoffMs) {
      return {
        status: 'expired',
        resolvedPrice: after.at(-1)?.close ?? entry,
      };
    }
    // Wait for post-signal bars; do not invent a path from pre-signal history.
    if (after.length === 0) return null;
    // Shorts: target < entry < stop. Longs: stop < entry < target.
    const isShort = stop > entry && target < entry;
    for (const bar of after) {
      if (isShort) {
        if (bar.high >= stop) return { status: 'hit_stop', resolvedPrice: stop };
        if (bar.low <= target)
          return { status: 'hit_target', resolvedPrice: target };
      } else {
        if (bar.low <= stop) return { status: 'hit_stop', resolvedPrice: stop };
        if (bar.high >= target)
          return { status: 'hit_target', resolvedPrice: target };
      }
    }
    return null;
  }

  /**
   * Bars used for barrier resolution: prefer live provider 5-min bars after
   * `generatedAt`, then daily, then local DB — always filtered to ≥ generatedAt.
   */
  async loadBarsForResolve(
    symbol: string,
    generatedAt: Date,
  ): Promise<MlBar[]> {
    const to = new Date(Date.now() - 16 * 60_000);
    const from = new Date(generatedAt.getTime() - 60_000);
    if (to.getTime() <= from.getTime()) return [];

    const toMl = (bars: Array<{
      timestamp: Date | string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>): MlBar[] =>
      bars
        .map((bar) => ({
          timestamp:
            bar.timestamp instanceof Date
              ? bar.timestamp.toISOString()
              : new Date(bar.timestamp).toISOString(),
          open: Number(bar.open),
          high: Number(bar.high),
          low: Number(bar.low),
          close: Number(bar.close),
          volume: Number(bar.volume),
        }))
        .filter(
          (bar) =>
            new Date(bar.timestamp).getTime() >= generatedAt.getTime(),
        );

    try {
      const fiveMin = await this.marketData.getHistoricalBars(
        symbol,
        '5min',
        from,
        to,
      );
      const path = toMl(fiveMin);
      if (path.length > 0) return path;
    } catch (error) {
      this.logger.warn(
        `Resolve 5min bars failed for ${symbol}: ${(error as Error).message}`,
      );
    }

    try {
      const daily = await this.marketData.getHistoricalBars(
        symbol,
        '1d',
        from,
        to,
      );
      const path = toMl(daily);
      if (path.length > 0) return path;
    } catch (error) {
      this.logger.warn(
        `Resolve daily bars failed for ${symbol}: ${(error as Error).message}`,
      );
    }

    const stored = await this.loadBars(symbol, 60);
    return stored.filter(
      (bar) => new Date(bar.timestamp).getTime() >= generatedAt.getTime(),
    );
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
        const bars = await this.loadBarsForResolve(
          signal.symbol,
          signal.generatedAt,
        );
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
        const cacheKey = `${evaluation.symbol}:${evaluation.generatedAt.getTime()}`;
        let bars = barsCache.get(cacheKey);
        if (!bars) {
          bars = await this.loadBarsForResolve(
            evaluation.symbol,
            evaluation.generatedAt,
          );
          barsCache.set(cacheKey, bars);
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
    const signalUniverse = await this.signalUniverse.build();
    const shadowCandidatesByRegime = await this.loadShadowCandidates();
    let predictions = 0;
    let signalsCreated = 0;
    let shadowPredictions = 0;
    let shadowEvaluations = 0;
    const usedStrategies = new Map<string, number>();

    for (const symbol of signalUniverse) {
      try {
        const bars = await this.loadBars(symbol, 120);
        if (bars.length < 60) continue;
        const prediction = await this.predict(symbol, bars);
        const strategyId = pickStrategyId(
          prediction.regime,
          prediction.confidence,
        );
        const risk = STRATEGY_RISK[strategyId] ?? STRATEGY_RISK.tb_balanced;
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

        // Model labels are long-trade outcomes (tp / sl / timeout), not
        // direction. Predicting "sl" means "don't enter" — never invent a short.
        if (
          prediction.fallback ||
          !prediction.model_version ||
          prediction.prediction !== 'tp' ||
          prediction.confidence < minConfidence
        ) {
          continue;
        }
        const tradeSide = 'buy' as const;
        const activeModel = await this.prisma.modelRegistry.findUnique({
          where: { version: prediction.model_version },
          select: { isActive: true, status: true, regime: true },
        });
        if (!activeModel?.isActive || activeModel.status !== 'active') {
          this.logger.warn(
            `Prediction ignored: ${prediction.model_version} is not an active champion`,
          );
          continue;
        }
        // Prefer regime-matched champions; if the only live model is for
        // another regime, still trade so the bot is not stuck silent.
        if (activeModel.regime !== prediction.regime) {
          this.logger.warn(
            `Using active model ${prediction.model_version} (${activeModel.regime}) for ${prediction.regime} prediction on ${symbol}`,
          );
        }

        const last = bars[bars.length - 1];
        const entry = last.close;
        const signalTargets = computeRiskTargets({
          entry,
          strategyId,
          maxRiskPerTrade: 2,
          confidence: prediction.confidence,
          side: tradeSide,
        });
        const stop = signalTargets.stopPrice;
        const target = signalTargets.targetPrice;
        usedStrategies.set(strategyId, (usedStrategies.get(strategyId) ?? 0) + 1);
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
          side: tradeSide,
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
          select: {
            id: true,
            riskSettings: true,
            simAccount: { select: { balance: true } },
          },
          take: 200,
        });
        for (const user of premiumUsers) {
          const maxRisk = user.riskSettings?.maxRiskPerTrade ?? 2;
          const userTargets = computeRiskTargets({
            entry,
            strategyId,
            maxRiskPerTrade: maxRisk,
            confidence: prediction.confidence,
            side: tradeSide,
          });
          const equity = Number(user.simAccount?.balance ?? 100_000);
          const qty = computePositionSize({
            equity,
            entryPrice: entry,
            stopPrice: userTargets.stopPrice,
            targetPrice: userTargets.targetPrice,
            confidence: prediction.confidence,
            maxRiskPerTrade: maxRisk,
          });
          await this.simulation
            .openOrder(user.id, {
              symbol,
              side: tradeSide,
              quantity: qty,
              entryPrice: entry,
              stopPrice: userTargets.stopPrice,
              targetPrice: userTargets.targetPrice,
              source: 'ai_signal',
            })
            .catch(() => undefined);
        }
        this.logger.log(
          `Signal created ${tradeSide} ${symbol} strategy=${strategyId} conf=${prediction.confidence.toFixed(2)}`,
        );
      } catch (err) {
        this.logger.warn(
          `Signal generation failed for ${symbol}: ${(err as Error).message}`,
        );
      }
    }

    if (usedStrategies.size > 0) {
      const summary = [...usedStrategies.entries()]
        .map(([id, count]) => `${id}=${count}`)
        .join(' ');
      this.logger.log(`Signal strategies this run: ${summary}`);
      await this.persistDailyStrategySelections(usedStrategies).catch((err) =>
        this.logger.warn(
          `Could not persist daily strategy selections: ${(err as Error).message}`,
        ),
      );
    }

    return { predictions, signalsCreated, shadowPredictions, shadowEvaluations };
  }

  /** Audit trail of which barrier profiles were used today. */
  private async persistDailyStrategySelections(
    used: Map<string, number>,
  ): Promise<void> {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const ranked = [...used.entries()].sort((a, b) => b[1] - a[1]);
    for (let rank = 0; rank < ranked.length; rank += 1) {
      const [strategyId] = ranked[rank];
      await this.prisma.dailyStrategySelection.upsert({
        where: { date_rank: { date: day, rank: rank + 1 } },
        create: {
          date: day,
          rank: rank + 1,
          strategyId,
          regime: 'mixed',
        },
        update: { strategyId, regime: 'mixed' },
      });
    }
  }

  private async schedule(
    queueName: string,
    jobName: string,
    pattern: string,
    handler: () => Promise<void>,
    connection: ReturnType<MlBridgeService['connectionOptions']>,
  ): Promise<Queue> {
    const queue = new Queue(queueName, { connection });
    const worker = new Worker(queueName, async () => handler(), {
      connection,
      concurrency: 1,
      lockDuration: 120_000,
    });
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
    return queue;
  }

  private connectionOptions() {
    return bullmqConnection(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all(this.queues.map((q) => q.close().catch(() => undefined)));
  }
}

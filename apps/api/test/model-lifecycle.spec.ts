import { ConfigService } from '@nestjs/config';
import { computeBrier, computeDrift } from '../src/models/drift';
import { ModelLifecycleService } from '../src/models/model-lifecycle.service';

describe('drift & calibration math', () => {
  it('reports insufficient data below 40 rows', () => {
    const rows = Array.from({ length: 10 }, () => ({ rsi: 50 }));
    const result = computeDrift(rows);
    expect(result.level).toBe('insufficient_data');
    expect(result.score).toBeNull();
  });

  it('flags alert when the recent half shifts strongly', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => ({
      rsi: 50 + (i % 3),
    }));
    const recent = Array.from({ length: 30 }, (_, i) => ({
      rsi: 90 + (i % 3),
    }));
    // computeDrift treats the first half as recent (newest-first ordering).
    const result = computeDrift([...recent, ...baseline]);
    expect(result.level).toBe('alert');
    expect(result.score).toBeGreaterThan(1);
  });

  it('stays stable for identical populations', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ rsi: 50 + (i % 5) }));
    const result = computeDrift(rows);
    expect(result.level).toBe('stable');
  });

  it('computes Brier score only over resolved predictions', () => {
    const result = computeBrier([
      {
        probabilities: { tp: 1, sl: 0, timeout: 0 },
        actualLabel: 'tp',
      },
      {
        probabilities: { tp: 0.5, sl: 0.3, timeout: 0.2 },
        actualLabel: null,
      },
    ]);
    expect(result.sampleSize).toBe(1);
    expect(result.brierScore).toBe(0);
  });
});

describe('ModelLifecycleService', () => {
  const config = new ConfigService({
    DISABLE_WORKERS: 'true',
    MODEL_ROLLBACK_MIN_SAMPLES: '20',
    MODEL_ROLLBACK_HIT_RATE: '0.45',
    MODEL_MIN_SOAK_HOURS: '72',
    MODEL_MIN_SHADOW_SAMPLES: '20',
  });

  /** Decisive shadow outcomes: `wins` hit_target rows, rest hit_stop. */
  function shadowOutcomes(total: number, wins: number) {
    return Array.from({ length: total }, (_, i) => ({
      status: i < wins ? 'hit_target' : 'hit_stop',
    }));
  }

  function build(overrides: {
    models?: unknown[];
    signals?: unknown[];
    predictions?: unknown[];
    shadowEvaluations?: unknown[];
  }) {
    const prisma = {
      modelRegistry: {
        findMany: jest.fn().mockResolvedValue(overrides.models ?? []),
        update: jest.fn().mockResolvedValue({}),
      },
      signal: {
        findMany: jest.fn().mockResolvedValue(overrides.signals ?? []),
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue(overrides.predictions ?? []),
      },
      shadowEvaluation: {
        findMany: jest
          .fn()
          .mockResolvedValue(overrides.shadowEvaluations ?? []),
      },
    };
    const ml = {
      promoteModel: jest.fn().mockResolvedValue({ promoted: true }),
      loadBars: jest.fn().mockResolvedValue([]),
      train: jest.fn().mockResolvedValue({}),
    };
    const alerts = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new ModelLifecycleService(
      config,
      prisma as never,
      ml as never,
      alerts as never,
    );
    return { service, prisma, ml, alerts };
  }

  it('rolls back a champion whose live hit rate is below threshold', async () => {
    const champion = {
      version: 'model-a',
      regime: 'trending',
      isActive: true,
      status: 'active',
      expectancy: 0.02,
      precision: 0.6,
    };
    const losers = Array.from({ length: 25 }, (_, i) => ({
      status: i < 5 ? 'hit_target' : 'hit_stop',
    }));
    const { service, prisma, alerts } = build({
      models: [champion],
      signals: losers,
    });
    // First findMany call (rollback) returns champions; second (promotion)
    // returns the full registry.
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([champion])
      .mockResolvedValueOnce([champion]);

    const report = await service.runLifecycle();
    expect(report.rollbacks).toHaveLength(1);
    expect(prisma.modelRegistry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: 'model-a' },
        data: expect.objectContaining({
          isActive: false,
          status: 'shadow',
          // The soak clock restarts so the demoted champion cannot bounce
          // straight back on stale history.
          shadowStartedAt: expect.any(Date),
        }),
      }),
    );
    expect(alerts.send).toHaveBeenCalledWith(
      'model.rollback',
      'warning',
      expect.any(Object),
    );
  });

  it('promotes a challenger that beats the champion offline and passes soak gates', async () => {
    const champion = {
      version: 'model-old',
      regime: 'trending',
      isActive: true,
      status: 'active',
      expectancy: 0.01,
      precision: 0.6,
      trainedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    };
    const challenger = {
      version: 'model-new',
      regime: 'trending',
      isActive: false,
      status: 'shadow',
      expectancy: 0.03,
      precision: 0.62,
      // Soaked for 10 days — well past the 72h minimum.
      trainedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      shadowStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    };
    const { service, prisma, ml } = build({
      models: [champion, challenger],
      signals: [],
      // 25 resolved hidden samples at 60% — above the 45% rollback floor
      // (the champion has no live record yet).
      shadowEvaluations: shadowOutcomes(25, 15),
    });
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([champion])
      .mockResolvedValueOnce([champion, challenger]);

    const report = await service.runLifecycle();
    expect(ml.promoteModel).toHaveBeenCalledWith('model-new');
    expect(report.promotions).toEqual([
      expect.objectContaining({ version: 'model-new', regime: 'trending' }),
    ]);
    expect(report.holds).toHaveLength(0);
  });

  it('never promotes a same-day retrain even with better offline metrics', async () => {
    const champion = {
      version: 'model-old',
      regime: 'trending',
      isActive: true,
      status: 'active',
      expectancy: 0.01,
      precision: 0.6,
      trainedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    };
    const freshChallenger = {
      version: 'model-fresh',
      regime: 'trending',
      isActive: false,
      status: 'shadow',
      expectancy: 0.05,
      precision: 0.7,
      // Trained two hours ago — e.g. by the weekly retrain job.
      trainedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      shadowStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    };
    const { service, prisma, ml } = build({
      models: [champion, freshChallenger],
      signals: [],
      shadowEvaluations: shadowOutcomes(25, 15),
    });
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([champion])
      .mockResolvedValueOnce([champion, freshChallenger]);

    const report = await service.runLifecycle();
    expect(ml.promoteModel).not.toHaveBeenCalled();
    expect(report.promotions).toHaveLength(0);
    expect(report.holds).toEqual([
      expect.objectContaining({
        version: 'model-fresh',
        regime: 'trending',
        reason: expect.stringContaining('soak age'),
      }),
    ]);
  });

  it('holds a soaked challenger without enough resolved shadow samples', async () => {
    const challenger = {
      version: 'model-thin',
      regime: 'trending',
      isActive: false,
      status: 'shadow',
      expectancy: 0.05,
      precision: 0.7,
      trainedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      shadowStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    };
    const { service, prisma, ml } = build({
      models: [challenger],
      signals: [],
      shadowEvaluations: shadowOutcomes(5, 4),
    });
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([challenger]);

    const report = await service.runLifecycle();
    expect(ml.promoteModel).not.toHaveBeenCalled();
    expect(report.holds).toEqual([
      expect.objectContaining({
        version: 'model-thin',
        reason: expect.stringContaining('resolved live shadow samples'),
      }),
    ]);
  });

  it('holds a challenger whose live shadow hit rate trails the champion', async () => {
    const champion = {
      version: 'model-old',
      regime: 'trending',
      isActive: true,
      status: 'active',
      expectancy: 0.01,
      precision: 0.6,
      trainedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    };
    const challenger = {
      version: 'model-lucky-backtest',
      regime: 'trending',
      isActive: false,
      status: 'shadow',
      expectancy: 0.05,
      precision: 0.7,
      trainedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      shadowStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    };
    // Champion's live record: 80% over 30 signals (also keeps it clear of
    // the rollback pass). Challenger's hidden record: only 48%.
    const championSignals = Array.from({ length: 30 }, (_, i) => ({
      status: i < 24 ? 'hit_target' : 'hit_stop',
    }));
    const { service, prisma, ml } = build({
      models: [champion, challenger],
      signals: championSignals,
      shadowEvaluations: shadowOutcomes(25, 12),
    });
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([champion])
      .mockResolvedValueOnce([champion, challenger]);

    const report = await service.runLifecycle();
    expect(ml.promoteModel).not.toHaveBeenCalled();
    expect(report.holds).toEqual([
      expect.objectContaining({
        version: 'model-lucky-backtest',
        reason: expect.stringContaining('below champion live hit rate'),
      }),
    ]);
  });

  it('does not promote a challenger weaker than the champion', async () => {
    const champion = {
      version: 'model-old',
      regime: 'trending',
      isActive: true,
      status: 'active',
      expectancy: 0.05,
      precision: 0.7,
    };
    const challenger = {
      version: 'model-weak',
      regime: 'trending',
      isActive: false,
      status: 'shadow',
      expectancy: 0.01,
      precision: 0.5,
    };
    const { service, prisma, ml } = build({
      models: [champion, challenger],
      signals: [],
    });
    prisma.modelRegistry.findMany
      .mockResolvedValueOnce([champion])
      .mockResolvedValueOnce([champion, challenger]);

    await service.runLifecycle();
    expect(ml.promoteModel).not.toHaveBeenCalled();
  });

  it('triggers shadow retrains on drift alert', async () => {
    const baseline = Array.from({ length: 30 }, () => ({
      features: { rsi: 50 },
    }));
    const recent = Array.from({ length: 30 }, (_, i) => ({
      features: { rsi: 95 + (i % 2) },
    }));
    const bars = Array.from({ length: 150 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 86_400_000).toISOString(),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));
    const { service, prisma, ml, alerts } = build({
      models: [],
      signals: [],
      predictions: [...recent, ...baseline],
    });
    prisma.modelRegistry.findMany.mockResolvedValue([]);
    ml.loadBars.mockResolvedValue(bars);

    const report = await service.runLifecycle();
    expect(report.drift.level).toBe('alert');
    expect(ml.train).toHaveBeenCalled();
    expect(report.retrains.length).toBeGreaterThan(0);
    expect(alerts.send).toHaveBeenCalledWith(
      'model.drift_alert',
      'warning',
      expect.any(Object),
    );
  });
});

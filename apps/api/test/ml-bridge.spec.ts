import { MlBridgeService, MlBar } from '../src/signals/ml-bridge.service';

describe('MlBridgeService signal gates', () => {
  const bars: MlBar[] = Array.from({ length: 80 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1000,
  }));

  function makeService(
    active: boolean,
    options: { shadowCandidates?: Array<{ version: string; regime: string }> } = {},
  ) {
    let predictionSeq = 0;
    const prisma = {
      dailyStrategySelection: {
        findMany: jest.fn().mockResolvedValue([{ strategyId: 'tb_balanced' }]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      prediction: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `prediction-${++predictionSeq}`,
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      modelRegistry: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: active,
          status: active ? 'active' : 'shadow',
          regime: 'trend',
        }),
        findMany: jest
          .fn()
          .mockResolvedValue(options.shadowCandidates ?? []),
      },
      signal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'signal-1',
          ...data,
          generatedAt: new Date('2026-01-01T00:00:00Z'),
        })),
      },
      shadowEvaluation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'shadow-eval-1',
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    const gateway = {
      emitNewSignal: jest.fn(),
      emitSignalResolved: jest.fn(),
    };
    const simulation = { openOrder: jest.fn() };
    const service = new MlBridgeService(
      { get: jest.fn() } as never,
      prisma as never,
      gateway as never,
      simulation as never,
      { getHistoricalBars: jest.fn() } as never,
    );
    jest
      .spyOn(service, 'loadBars')
      .mockImplementation(async (symbol) => (symbol === 'AAPL' ? bars : []));
    jest
      .spyOn(service, 'predict')
      .mockImplementation(async (symbol, _bars, modelVersion) => ({
        symbol,
        prediction: 'tp',
        confidence: 0.8,
        probabilities: { tp: 0.8, sl: 0.1, timeout: 0.1 },
        regime: 'trend',
        model_version: modelVersion ?? 'model-1',
        fallback: false,
        features: { rsi_14: 55 },
        feature_timestamp: '2026-01-01T00:00:00.000Z',
      }));
    return { service, prisma, gateway, simulation };
  }

  it('persists inference but blocks signals from a shadow model', async () => {
    const { service, prisma } = makeService(false);

    const result = await service.generateSignals();

    expect(result).toEqual({
      predictions: 1,
      signalsCreated: 0,
      shadowPredictions: 0,
      shadowEvaluations: 0,
    });
    expect(prisma.prediction.create).toHaveBeenCalledTimes(1);
    expect(prisma.signal.create).not.toHaveBeenCalled();
  });

  it('creates a signal linked to an active model and prediction', async () => {
    const { service, prisma, gateway } = makeService(true);

    const result = await service.generateSignals();

    expect(result).toEqual({
      predictions: 1,
      signalsCreated: 1,
      shadowPredictions: 0,
      shadowEvaluations: 0,
    });
    expect(prisma.signal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelVersion: 'model-1',
          predictionId: 'prediction-1',
        }),
      }),
    );
    expect(gateway.emitNewSignal).toHaveBeenCalledTimes(1);
  });

  it('scores shadow candidates without any user-visible exposure', async () => {
    const { service, prisma, gateway, simulation } = makeService(true, {
      shadowCandidates: [{ version: 'shadow-1', regime: 'trend' }],
    });

    const result = await service.generateSignals();

    expect(result).toEqual({
      predictions: 1,
      signalsCreated: 1,
      shadowPredictions: 1,
      shadowEvaluations: 1,
    });
    // The challenger inference is persisted, flagged as shadow.
    expect(prisma.prediction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelVersion: 'shadow-1',
          shadow: true,
        }),
      }),
    );
    // The hidden evaluation is stored, but never becomes a Signal, is never
    // emitted over WebSocket, and never opens simulated orders.
    expect(prisma.shadowEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelVersion: 'shadow-1',
          symbol: 'AAPL',
          status: 'open',
        }),
      }),
    );
    expect(prisma.signal.create).toHaveBeenCalledTimes(1); // champion only
    expect(gateway.emitNewSignal).toHaveBeenCalledTimes(1); // champion only
    expect(simulation.openOrder).not.toHaveBeenCalled();
  });

  it('skips a shadow candidate the ML service could not score as requested', async () => {
    const { service, prisma } = makeService(true, {
      shadowCandidates: [{ version: 'shadow-1', regime: 'trend' }],
    });
    // The service answers the versioned call with the production model —
    // that is not a valid shadow sample and must be dropped.
    jest.spyOn(service, 'predict').mockResolvedValue({
      symbol: 'AAPL',
      prediction: 'tp',
      confidence: 0.8,
      probabilities: { tp: 0.8, sl: 0.1, timeout: 0.1 },
      regime: 'trend',
      model_version: 'model-1',
      fallback: false,
      features: { rsi_14: 55 },
      feature_timestamp: '2026-01-01T00:00:00.000Z',
    });

    const result = await service.generateSignals();

    expect(result.shadowPredictions).toBe(0);
    expect(result.shadowEvaluations).toBe(0);
    expect(prisma.shadowEvaluation.create).not.toHaveBeenCalled();
  });
});

describe('MlBridgeService shadow evaluation resolution', () => {
  function makeResolver(evaluations: unknown[], barsForSymbol: MlBar[]) {
    const prisma = {
      shadowEvaluation: {
        findMany: jest.fn().mockResolvedValue(evaluations),
        update: jest.fn().mockResolvedValue({}),
      },
      prediction: {
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    const gateway = {
      emitNewSignal: jest.fn(),
      emitSignalResolved: jest.fn(),
    };
    const service = new MlBridgeService(
      { get: jest.fn() } as never,
      prisma as never,
      gateway as never,
      { openOrder: jest.fn() } as never,
      { getHistoricalBars: jest.fn() } as never,
    );
    jest.spyOn(service, 'loadBarsForResolve').mockResolvedValue(barsForSymbol);
    return { service, prisma, gateway };
  }

  const recentBars: MlBar[] = Array.from({ length: 10 }, (_, index) => ({
    timestamp: new Date(Date.now() - (10 - index) * 60_000).toISOString(),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1000,
  }));

  it('resolves a target hit silently and back-fills the prediction label', async () => {
    const { service, prisma, gateway } = makeResolver(
      [
        {
          id: 'eval-1',
          symbol: 'AAPL',
          modelVersion: 'shadow-1',
          entryPrice: 100,
          stopPrice: 98.5,
          targetPrice: 101.5,
          generatedAt: new Date(Date.now() - 60 * 60 * 1000),
          predictionId: 'prediction-9',
          status: 'open',
        },
      ],
      recentBars,
    );

    const result = await service.resolveShadowEvaluations();

    expect(result).toEqual({ resolved: 1 });
    expect(prisma.shadowEvaluation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'eval-1' },
        data: expect.objectContaining({ status: 'hit_target' }),
      }),
    );
    expect(prisma.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prediction-9' },
        data: expect.objectContaining({ actualLabel: 'tp' }),
      }),
    );
    // Absolutely no user exposure on the shadow path.
    expect(gateway.emitSignalResolved).not.toHaveBeenCalled();
    expect(gateway.emitNewSignal).not.toHaveBeenCalled();
  });

  it('expires stale shadow evaluations past the max age', async () => {
    const { service, prisma } = makeResolver(
      [
        {
          id: 'eval-2',
          symbol: 'AAPL',
          modelVersion: 'shadow-1',
          entryPrice: 100,
          stopPrice: 98.5,
          targetPrice: 200, // never reached
          generatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          predictionId: 'prediction-10',
          status: 'open',
        },
      ],
      recentBars.map((bar) => ({ ...bar, low: 99.5 })),
    );

    const result = await service.resolveShadowEvaluations(48);

    expect(result).toEqual({ resolved: 1 });
    expect(prisma.shadowEvaluation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'eval-2' },
        data: expect.objectContaining({ status: 'expired' }),
      }),
    );
    expect(prisma.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actualLabel: 'timeout' }),
      }),
    );
  });

  it('does not mark hit_target from bars that only exist before generatedAt', async () => {
    const generatedAt = new Date(Date.now() - 30 * 60 * 1000);
    const preSignalBars: MlBar[] = Array.from({ length: 5 }, (_, index) => ({
      timestamp: new Date(
        generatedAt.getTime() - (5 - index) * 60_000,
      ).toISOString(),
      open: 100,
      high: 250, // would falsely hit any realistic target if used
      low: 99,
      close: 101,
      volume: 1000,
    }));
    const { service, prisma } = makeResolver(
      [
        {
          id: 'eval-3',
          symbol: 'IBM',
          modelVersion: 'shadow-1',
          entryPrice: 210,
          stopPrice: 208,
          targetPrice: 214,
          generatedAt,
          predictionId: 'prediction-11',
          status: 'open',
        },
      ],
      preSignalBars,
    );

    const result = await service.resolveShadowEvaluations();

    expect(result).toEqual({ resolved: 0 });
    expect(prisma.shadowEvaluation.update).not.toHaveBeenCalled();
  });
});

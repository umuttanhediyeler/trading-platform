import { computePositionSize } from './position-sizing';
import { computeRiskTargets } from './risk-targets';

describe('position-sizing', () => {
  it('sizes from risk budget without arbitrary share cap', () => {
    const qty = computePositionSize({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      maxRiskPerTrade: 2,
    });
    expect(qty).toBe(250);
  });

  it('respects exposure cap', () => {
    const qty = computePositionSize({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      maxRiskPerTrade: 2,
      maxTotalExposurePct: 10,
      currentExposure: 0,
    });
    expect(qty).toBe(50);
  });
});

describe('risk-targets', () => {
  it('widens reward target with higher risk appetite', () => {
    const conservative = computeRiskTargets({
      entry: 100,
      strategyId: 'tb_balanced',
      maxRiskPerTrade: 1,
      confidence: 0.6,
    });
    const aggressive = computeRiskTargets({
      entry: 100,
      strategyId: 'tb_balanced',
      maxRiskPerTrade: 3,
      confidence: 0.75,
    });
    expect(aggressive.takeProfitPercent).toBeGreaterThan(
      conservative.takeProfitPercent,
    );
  });
});

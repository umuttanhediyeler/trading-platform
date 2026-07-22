import { describe, expect, it } from '@jest/globals';
import { computePositionSize } from './position-sizing';
import { computeRiskTargets, pickStrategyId } from './risk-targets';

describe('position-sizing', () => {
  it('sizes from risk budget with per-trade notional cap', () => {
    const qty = computePositionSize({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      maxRiskPerTrade: 2,
    });
    // Risk budget wants 250, but 15% equity notional cap → 75 shares.
    expect(qty).toBe(75);
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

  it('picks diversified strategies from regime + confidence', () => {
    expect(pickStrategyId('trend', 0.8)).toBe('tb_momentum');
    expect(pickStrategyId('range', 0.65)).toBe('tb_mean_revert');
    expect(pickStrategyId('high_vol', 0.6)).toBe('tb_tight_scalp');
    expect(pickStrategyId('high_vol', 0.8)).toBe('tb_wide_swing');
    expect(pickStrategyId('unknown', 0.66)).toBe('tb_balanced');
  });
});
